import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { Delaunay3D } from './classes.js';
import { Brush, Evaluator, INTERSECTION } from 'three-bvh-csg';

// --- Global Variables ---
let scene, camera, renderer, controls;
let delaunay, points, pointIndex, animationFrameId;

const materials = {
    point: new THREE.PointsMaterial({ color: 0x00aaff, size: 0.1 }),
    tetra: new THREE.LineBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.3 }),
    badTetra: new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 }),
    cavity: new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 }),
    newTetra: new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 }),
    voronoi: new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 })
};

const BOX_SIZE = 10;
const JITTER_AMOUNT = 1e-6;
const sceneObjects = {
    points: new THREE.Group(),
    delaunayEdges: new THREE.Group(),
    voronoiEdges: new THREE.Group(),
    voronoiRegions: new THREE.Group(),
};

const startBtn = document.getElementById('start-btn');
const nextBtn = document.getElementById('next-btn');
const runAllBtn = document.getElementById('run-all-btn');
const pointsSlider = document.getElementById('points-slider');
const pointsCountSpan = document.getElementById('points-count');
const stepInfo = document.getElementById('step-info');

function init() {
    // Scene
    scene = new THREE.Scene();
    scene.add(sceneObjects.points, sceneObjects.delaunayEdges, sceneObjects.voronoiEdges, sceneObjects.voronoiRegions);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 15);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    // renderer.localClippingEnabled = true;
    document.body.appendChild(renderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);
    scene.background = new THREE.Color(0xFFFFFF);

    // Bounding Box
    const boxGeom = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);
    const boxEdges = new THREE.EdgesGeometry(boxGeom);
    const boxLines = new THREE.LineSegments(boxEdges, new THREE.LineBasicMaterial({ color: 0x000000 }));
    scene.add(boxLines);

    // Event Listeners
    window.addEventListener('resize', onWindowResize);
    startBtn.addEventListener('click', setupSimulation);
    nextBtn.addEventListener('click', doNextStep);
    runAllBtn.addEventListener('click', runAllSteps);
    pointsSlider.addEventListener('input', (e) => pointsCountSpan.textContent = e.target.value);

    animate();
}

const dot = () => {
    const radius = 0.1;
    const geometry = new THREE.SphereGeometry(radius, 16, 12);
    const material = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
};

// Logic for simulation
function setupSimulation() {
    // Reset state
    cancelAnimationFrame(animationFrameId);
    pointIndex = 0;
    points = [];
    clearScene();
    scene.background = new THREE.Color(0xffffff);

    // Generate random points
    const numPoints = parseInt(pointsSlider.value);
    for (let i = 0; i < numPoints; i++) {
        const pos = new THREE.Vector3(
            (Math.random() - 0.5) * BOX_SIZE,
            (Math.random() - 0.5) * BOX_SIZE,
            (Math.random() - 0.5) * BOX_SIZE
        );

        pos.x += (Math.random() - 0.5) * JITTER_AMOUNT;
        pos.y += (Math.random() - 0.5) * JITTER_AMOUNT;
        pos.z += (Math.random() - 0.5) * JITTER_AMOUNT;

        // each starting point is just a small sphere
        const sphere = dot();
        sphere.position.copy(pos);

        // add to the points array used by Delauney
        sceneObjects.points.add(sphere);
        points.push(pos);
    }

    // Initialize Delaunay
    delaunay = new Delaunay3D(BOX_SIZE * 10);
    drawDelaunay();

    // Update UI
    stepInfo.innerHTML = `Initialized with super-tetrahedron.<br>Ready to add ${numPoints} points.`;
    startBtn.textContent = 'Restart';
    nextBtn.disabled = false;
    runAllBtn.disabled = false;
    sceneObjects.delaunayEdges.visible = true;

    animate();
}

function doNextStep() {
    if (pointIndex >= points.length) {
        stepInfo.textContent = 'All points have been added. Triangulation complete!';
        nextBtn.disabled = true;
        runAllBtn.disabled = true;
        sceneObjects.delaunayEdges.visible = false;
        drawVoronoi();
        pointIndex++;
        return;
    }

    const point = points[pointIndex];
    const { badTetras, cavityFaces, newTetras } = delaunay.addPoint(point);
    pointIndex++;

    // Visualize the step
    visualizeStep(point, badTetras, cavityFaces, newTetras);

    stepInfo.innerHTML = `<b>Step ${pointIndex}/${points.length}:</b> Adding point.<br>
        Found ${badTetras.length} bad tetrahedra (red).<br>
        Formed cavity of ${cavityFaces.length} faces (yellow).<br>
        Created ${newTetras.length} new tetrahedra (green).`;
}

function next() {
    // run the next step
    doNextStep();
    // if it was the last step, stop the animation loop
    if (pointIndex > points.length) return;
    // otherwise, after a delay, run the next step
    setTimeout(next, 200);
};

function runAllSteps() {
    nextBtn.disabled = true;
    runAllBtn.disabled = true;
    next();
};


// --- Visualization ---
function clearScene() {
    [sceneObjects.points, sceneObjects.delaunayEdges, sceneObjects.voronoiEdges, sceneObjects.voronoiRegions].forEach(group => {
        while (group.children.length) group.remove(group.children[0]);
    });
}

function drawDelaunay() {
    while (sceneObjects.delaunayEdges.children.length) {
        sceneObjects.delaunayEdges.remove(sceneObjects.delaunayEdges.children[0]);
    }
    const finalTetras = delaunay.getTriangulation();
    const edges = getTetraEdges(finalTetras);
    sceneObjects.delaunayEdges.add(new THREE.LineSegments(edges, materials.tetra));
}

function visualizeStep(point, badTetras, cavityFaces, newTetras) {
    clearScene();

    // for each point...
    for (let i = 0; i < pointIndex; i++) {
        // add point
        const sphere = dot();
        sphere.position.copy(points[i]);
        sceneObjects.points.add(sphere);
    };

    // Draw current "good" tetras
    const goodTetras = delaunay.tetrahedra.filter(t => !badTetras.includes(t) && !newTetras.includes(t));
    sceneObjects.delaunayEdges.add(new THREE.LineSegments(getTetraEdges(goodTetras), materials.tetra));

    // Highlight bad tetras
    sceneObjects.delaunayEdges.add(new THREE.LineSegments(getTetraEdges(badTetras), materials.badTetra));

    // Highlight cavity
    const cavityEdges = new THREE.BufferGeometry();
    const cavityPositions = [];
    cavityFaces.forEach(face => cavityPositions.push(face.a.x, face.a.y, face.a.z, face.b.x, face.b.y, face.b.z, face.b.x, face.b.y, face.b.z, face.c.x, face.c.y, face.c.z, face.c.x, face.c.y, face.c.z, face.a.x, face.a.y, face.a.z));
    cavityEdges.setAttribute('position', new THREE.Float32BufferAttribute(cavityPositions, 3));
    sceneObjects.delaunayEdges.add(new THREE.LineSegments(cavityEdges, materials.cavity));

    // Highlight newly added tetras
    sceneObjects.delaunayEdges.add(new THREE.LineSegments(getTetraEdges(newTetras), materials.newTetra));
}

const getPoints = tetrahedrons => {
    const points = new Set();
    const pointToCircumcenters = new Map();
    // for each tetrahedron...
    for (const tetra of tetrahedrons) {
        // get its circumcenter
        const cc = tetra.circumcenter;
        // if the circumcenter is missing, skip
        if (!cc) continue;
        // for each point...
        for (const point of tetra.points) {
            // add to set
            points.add(point);
            // if the point doesn't exist yet...
            if (!pointToCircumcenters.has(point))
                // add it to the map, as an empty array
                pointToCircumcenters.set(point, []);
            // add the circumcenter to the point's array
            pointToCircumcenters.get(point).push(cc.clone());
        };
    };
    // --
    return {
        points: points,
        pointToCircumcenters: pointToCircumcenters
    };
};

const drawVoronoiRegions = (tetrahedrons, bounds) => {
    // get points and map, from tetrahedron
    const { points, pointToCircumcenters } = getPoints(tetrahedrons);
    // for each point...
    for (const point of points) {
        // get its circumcenters
        const circumcenters = (pointToCircumcenters.get(point) || []);
        // if there are enough circumcenters to define a voronoi region...
        if (circumcenters.length >= 4) {
            // create geometry
            const geometry = new ConvexGeometry(circumcenters);
            // create material
            const material = new THREE.MeshBasicMaterial({
                color: (Math.random() * 0xffffff),
                transparent: true,
                opacity: 0.25,
                depthWrite: false,
                polygonOffset: true,
                side: THREE.DoubleSide
            });
            // create a mesh
            const mesh = new THREE.Mesh(geometry, material);
            // if the mesh doesn't have uv's...
            if (!mesh.geometry.attributes.uv) {
                // add uv's, and update normals
                const uvArray = new Float32Array(mesh.geometry.attributes.position.count * 2);
                mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
                mesh.geometry.computeVertexNormals();
            };
            // intersect mesh & bounds (clip to bounding box)
            const brushA = new Brush(mesh.geometry.clone());
            const brushB = new Brush(bounds.geometry.clone());
            const evaluator = new Evaluator();
            const clippedBrush = evaluator.evaluate(brushA, brushB, INTERSECTION);
            const clippedMesh = new THREE.Mesh(clippedBrush.geometry, mesh.material);
            // add metadata
            clippedMesh.userData.point = point;
            // add it to the scene
            sceneObjects.voronoiRegions.add(clippedMesh);
        };
    };
};

const drawVoronoi = () => {
    // clear previous visualizations
    while (sceneObjects.voronoiRegions.children.length)
        sceneObjects.voronoiRegions.remove(sceneObjects.voronoiRegions.children[0]);
    // get bounds
    const bounds = new THREE.Mesh(
        new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })
    );
    bounds.position.set(0, 0, 0);
    bounds.updateMatrixWorld();
    // add corner points to delaunay
    const half = ((BOX_SIZE / 2) * 1.5);
    for (let x = -1; x <= 1; x += 2) {
        for (let y = -1; y <= 1; y += 2) {
            for (let z = -1; z <= 1; z += 2) {
                delaunay.addPoint(new THREE.Vector3((x * half), (y * half), (z * half)));
            };
        };
    };
    // get the final tetrahedrons
    const tetrahedrons = delaunay.getTriangulation();
    // draw the voronoi regions
    drawVoronoiRegions(tetrahedrons, bounds);
};

function getTetraEdges(tetras) {
    const positions = [];
    tetras.forEach(tetra => {
        const p = tetra.points;
        positions.push(p[0].x, p[0].y, p[0].z, p[1].x, p[1].y, p[1].z);
        positions.push(p[0].x, p[0].y, p[0].z, p[2].x, p[2].y, p[2].z);
        positions.push(p[0].x, p[0].y, p[0].z, p[3].x, p[3].y, p[3].z);
        positions.push(p[1].x, p[1].y, p[1].z, p[2].x, p[2].y, p[2].z);
        positions.push(p[1].x, p[1].y, p[1].z, p[3].x, p[3].y, p[3].z);
        positions.push(p[2].x, p[2].y, p[2].z, p[3].x, p[3].y, p[3].z);
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geom;
}

function animate() {
    animationFrameId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init();