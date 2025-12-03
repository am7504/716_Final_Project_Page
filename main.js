import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { Delaunay3D } from './classes.js';
import { Brush, Evaluator, INTERSECTION } from 'three-bvh-csg';

// --- Global Variables ---
let scene, camera, renderer, controls;
let delaunay, points, pointIndex, animationFrameId;
let circumcenterPoints = [], circumcenterIndex = 0, circumcenterLength = 0;
let voronoiRegions = new Set(), voronoiRegionIndex = 0, voronoiRegionLength = 0, voronoiRegionMap = new Map();

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
    circumcenters: new THREE.Group(),
    voronoiEdges: new THREE.Group(),
    voronoiRegions: new THREE.Group(),
};
const box = new THREE.Box3(
    new THREE.Vector3((-BOX_SIZE / 2), (-BOX_SIZE / 2), (-BOX_SIZE / 2)),
    new THREE.Vector3((BOX_SIZE / 2), (BOX_SIZE / 2), (BOX_SIZE / 2))
);
const bounds = new THREE.Mesh(
    new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })
);
bounds.position.set(0, 0, 0);
bounds.updateMatrixWorld();

const startBtn = document.getElementById('start-btn');
const nextBtn = document.getElementById('next-btn');
const runAllBtn = document.getElementById('run-all-btn');
const pointsSlider = document.getElementById('points-slider');
const pointsCountSpan = document.getElementById('points-count');
const stage = document.getElementById('stage');
const step = document.getElementById('step');
const info = document.getElementById('info');

function init() {
    // Scene
    scene = new THREE.Scene();
    scene.add(sceneObjects.points, sceneObjects.delaunayEdges, sceneObjects.voronoiEdges, sceneObjects.circumcenters, sceneObjects.voronoiRegions);

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
    const ambientLight = new THREE.AmbientLight(0xffffff, 1);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);
    scene.background = new THREE.Color(0xF5F5F0);

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

const cube = (color = 0x808080) => {
    const geometry = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const material = new THREE.MeshStandardMaterial({ color: color });
    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
};

const dot = (color = 0x808080) => {
    const radius = 0.1;
    const geometry = new THREE.SphereGeometry(radius, 16, 12);
    const material = new THREE.MeshStandardMaterial({ color: color });
    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
};

// Logic for simulation
function setupSimulation() {
    // Reset state
    cancelAnimationFrame(animationFrameId);
    pointIndex = 0;
    circumcenterIndex = 0;
    voronoiRegionIndex = 0;
    points = [];
    circumcenterPoints = [];
    voronoiRegions = new Set();
    clearScene();
    scene.background = new THREE.Color(0xF5F5F0);

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
    stage.innerHTML = `Input definition`;
    step.innerHTML = `1/1`;
    info.innerHTML = `Generated ${numPoints} random point${numPoints !== 1 ? 's' : ''} in a ${BOX_SIZE}×${BOX_SIZE}×${BOX_SIZE} cube.<br>`;
    info.innerHTML += `Points are distributed uniformly with small jitter to prevent degeneracies.<br>`;
    info.innerHTML += `Initial super-tetrahedron created to contain all points. Press 'Next Step' to begin tetrahedralization.`;
    startBtn.textContent = 'Reset';
    nextBtn.disabled = false;
    runAllBtn.disabled = false;
    sceneObjects.delaunayEdges.visible = true;
    sceneObjects.circumcenters.visible = true;

    animate();
}

const doNextStep = () => {
    // --
    // 1) tetrahedrons
    // 2) circumcenters
    // 3) voronoi regions
    // --
    // if tetrahedralization is in-progress...
    if (pointIndex < points.length) {
        // update tetrahedralization
        tetrahedralization();
    }
    // if tetrahedralization is done...
    else if (pointIndex === points.length) {
        // increment index
        pointIndex++;
        // update the UI with summary
        const totalTetras = delaunay.tetrahedra.length;
        info.innerHTML = `Tetrahedralization complete!<br>`;
        info.innerHTML += `Successfully added all input points.<br>`;
        info.innerHTML += `Created ${totalTetras} tetrahedron${totalTetras !== 1 ? 'a' : ''} in total.<br>`;
        info.innerHTML += `Adding corner points to complete the boundary, then calculating circumcenters...`;
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
        // get points and map, from tetrahedron
        const { points, pointToCircumcenters } = getPoints(tetrahedrons);
        // get valid circumcenters
        let circumcenters = [];
        for (const tetrahedron of tetrahedrons) {
            // if the circumcenter is missing, skip
            if (!tetrahedron.circumcenter) continue;
            // if the circumcenter is not within the box, skip
            if (!box.containsPoint(tetrahedron.circumcenter)) continue;
            // otherwise, add it to circumcenter set
            circumcenters.push(tetrahedron.circumcenter);
        };
        // set circumcenter data
        circumcenterPoints = circumcenters;
        circumcenterLength = circumcenters.length;
        // set voronoi region data
        voronoiRegions = points;
        voronoiRegionLength = points.size;
        voronoiRegionMap = pointToCircumcenters;
    }
    // if there are circumcenters left to add...
    else if (circumcenterIndex < circumcenterLength) {
        // create and add marker, for the current circumcenter
        const circumcenter = circumcenterPoints[circumcenterIndex];
        const marker = cube(0xffaa00);
        marker.position.copy(circumcenter);
        sceneObjects.circumcenters.add(marker);
        // update the UI with detailed information
        stage.innerHTML = `Circumcenter Search`;
        step.innerHTML = `${circumcenterIndex + 1}/${circumcenterLength}`;
        
        // Format circumcenter coordinates
        const ccStr = `(${circumcenter.x.toFixed(3)}, ${circumcenter.y.toFixed(3)}, ${circumcenter.z.toFixed(3)})`;
        
        // Calculate distance from origin for context
        const distFromOrigin = Math.sqrt(
            circumcenter.x * circumcenter.x + 
            circumcenter.y * circumcenter.y + 
            circumcenter.z * circumcenter.z
        ).toFixed(2);
        
        // Build detailed info text
        let infoText = `Circumcenter ${circumcenterIndex + 1} of ${circumcenterLength}.<br>`;
        infoText += `- Coordinates: ${ccStr}<br>`;
        infoText += `- Distance from origin: ${distFromOrigin} units.<br>`;
        infoText += `- This is the center of a tetrahedron's circumsphere, `;
        infoText += `which will become a vertex in the Voronoi diagram.`;
        
        info.innerHTML = infoText;
        // increment index
        circumcenterIndex++;
    }
    // if circumcenter search is done...
    else if (circumcenterIndex === circumcenterLength) {
        // update the UI with summary
        info.innerHTML = `Circumcenter Search complete.<br>`;
        info.innerHTML += `Found ${circumcenterLength} valid circumcenter${circumcenterLength !== 1 ? 's' : ''} `;
        info.innerHTML += `within the bounding box.<br>`;
        info.innerHTML += `- Each circumcenter is a vertex of the Voronoi diagram.`;
        // increment index
        circumcenterIndex++;
    }
    // if there are voronoi regions left to add...
    else if (voronoiRegionIndex < voronoiRegionLength) {
        // get the next region
        const region = voronoiRegions.values().next().value;
        // remove the region
        voronoiRegions.delete(region);
        // get its circumcenters
        const circumcenters = (voronoiRegionMap.get(region) || []);
        // draw the voronoi region (pass the region point for better info)
        voronoi(circumcenters, bounds, region);
        // increment index
        voronoiRegionIndex++;
    }
    // if voronoi construction is done...
    else if (voronoiRegionIndex === voronoiRegionLength) {
        // hide the tetrahedralization edges
        sceneObjects.delaunayEdges.visible = false;
        sceneObjects.circumcenters.visible = false;
        // update the UI with summary
        info.innerHTML = `Voronoi Construction complete!<br>`;
        info.innerHTML += `- Successfully constructed ${voronoiRegionLength} Voronoi region${voronoiRegionLength !== 1 ? 's' : ''}.<br>`;
        info.innerHTML += `- Each colored region represents the set of points closest to its seed point.<br>`;
        info.innerHTML += `- The complete 3D space has been partitioned into these cells.`;
        nextBtn.disabled = true;
        runAllBtn.disabled = true;
        // increment index
        voronoiRegionIndex++;
    };
};

const tetrahedralization = () => {
    // add the current point
    const point = points[pointIndex];
    const { badTetras, cavityFaces, newTetras } = delaunay.addPoint(point);
    // increment index
    pointIndex++;
    // visualize the step
    visualizeStep(point, badTetras, cavityFaces, newTetras);
    // update the UI with detailed information
    stage.innerHTML = `Tetrahedralization`;
    step.innerHTML = `${pointIndex}/${points.length}`;
    
    // Format point coordinates
    const pointStr = `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`;
    
    // Build detailed info text
    let infoText = `Adding point ${pointIndex} at ${pointStr}.<br>`;
    
    if (badTetras.length > 0) {
        infoText += `<span style="color: #CC0000; font-weight: 600;">- Removed ${badTetras.length} bad tetrahedr${badTetras.length > 1 ? 'a' : 'on'}</span> `;
        infoText += `(circumspheres contain new point).<br>`;
    }
    
    if (cavityFaces.length > 0) {
        infoText += `<span style="color: #2563EB; font-weight: 600;">- Cavity has ${cavityFaces.length} boundary face${cavityFaces.length > 1 ? 's' : ''}</span>.<br>`;
    }
    
    if (newTetras.length > 0) {
        infoText += `<span style="color: #059669; font-weight: 600;">- Created ${newTetras.length} new tetrahedr${newTetras.length > 1 ? 'a' : 'on'}</span> `;
        infoText += `connecting point to cavity faces.`;
    } else {
        infoText += `Point is inside existing tetrahedron.`;
    }
    
    info.innerHTML = infoText;
};

function next() {
    // run the next step
    doNextStep();
    // if it was the last step, stop the animation loop
    if ((pointIndex > points.length) && (voronoiRegionIndex > voronoiRegionLength)) return;
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
    [sceneObjects.points, sceneObjects.delaunayEdges, sceneObjects.voronoiEdges, sceneObjects.voronoiRegions, sceneObjects.circumcenters].forEach(group => {
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

const voronoi = (circumcenters, bounds, regionPoint) => {
    const color = (Math.random() * 0xffffff);
    // if there are enough circumcenters to define a voronoi region...
    if (circumcenters.length >= 4) {
        // create geometry
        const geometry = new ConvexGeometry(circumcenters);
        // create material
        const material = new THREE.MeshBasicMaterial({
            color: color,
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
        // add it to the scene
        sceneObjects.voronoiRegions.add(clippedMesh);
    };
    // update the UI with detailed information
    stage.innerHTML = `Voronoi Construction`;
    step.innerHTML = `${voronoiRegionIndex + 1}/${voronoiRegionLength}`;
    
    // Format point coordinates if available
    let pointStr = '';
    if (regionPoint) {
        pointStr = ` at (${regionPoint.x.toFixed(2)}, ${regionPoint.y.toFixed(2)}, ${regionPoint.z.toFixed(2)})`;
    }
    
    // Build detailed info text
    let infoText = `Constructing Voronoi region ${voronoiRegionIndex + 1} of ${voronoiRegionLength}${pointStr}.<br>`;
    
    if (circumcenters.length >= 4) {
        infoText += `Using ${circumcenters.length} circumcenters to form convex hull.<br>`;
        infoText += `- This region contains all points closer to this seed than to any other.<br>`;
        
        // Calculate approximate region center
        const regionCenter = new THREE.Vector3();
        circumcenters.forEach(cc => regionCenter.add(cc));
        regionCenter.divideScalar(circumcenters.length);
        const centerStr = `(${regionCenter.x.toFixed(2)}, ${regionCenter.y.toFixed(2)}, ${regionCenter.z.toFixed(2)})`;
        infoText += `- Region center: ${centerStr}.`;
    } else {
        infoText += `- Insufficient circumcenters (${circumcenters.length} < 4) to form a valid region.`;
    }
    
    info.innerHTML = infoText;
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