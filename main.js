import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';

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
    voronoiEdges: new THREE.Group()
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
    scene.add(sceneObjects.points, sceneObjects.delaunayEdges, sceneObjects.voronoiEdges);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 15);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
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
    sceneObjects.voronoiEdges.visible = true;

    animate();
}

// Logic for sumulation
function setupSimulation() {
    // Reset state
    cancelAnimationFrame(animationFrameId);
    pointIndex = 0;
    points = [];
    clearScene();
    scene.background = new THREE.Color(0xffffff);

    // Generate random points
    const numPoints = parseInt(pointsSlider.value);
    let radius = 0.1
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
        const sphereGeom = new THREE.SphereGeometry(radius, 16, 12);
        const sphereMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
        const sphere = new THREE.Mesh(sphereGeom, sphereMat);
        sphere.position.copy(pos);

        // add to the points array used by Delauney
        sceneObjects.points.add(sphere);
        points.push(pos);
    }

    // Initialize Delaunay
    delaunay = new Delaunay3D(BOX_SIZE * 2);
    drawDelaunay();

    // Update UI
    stepInfo.innerHTML = `Initialized with super-tetrahedron.<br>Ready to add ${numPoints} points.`;
    startBtn.textContent = 'Restart';
    nextBtn.disabled = false;
    runAllBtn.disabled = false;

    animate();
}

function doNextStep() {
    if (pointIndex >= points.length) {
        stepInfo.textContent = 'All points have been added. Triangulation complete!';
        nextBtn.disabled = true;
        runAllBtn.disabled = true;
        sceneObjects.delaunayEdges.visible = false;
        drawVoronoi();
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

function runAllSteps() {
    nextBtn.disabled = true;
    runAllBtn.disabled = true;

    function next() {
        doNextStep();
        setTimeout(next, 200); // Delay between steps
        // if (pointIndex < points.length) {
            
        // } else {
        //     stepInfo.textContent = 'All points added. Triangulation complete!';
        //     drawDelaunay(); // Final clean draw
        //     // sceneObjects.delaunayEdges.visible = false;
        //     drawVoronoi();
        // }
    }
    next();
}


// --- Visualization ---
function clearScene() {
    [sceneObjects.points, sceneObjects.delaunayEdges, sceneObjects.voronoiEdges].forEach(group => {
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

    // Draw existing points
    const pointsGeom = new THREE.BufferGeometry().setFromPoints(points.slice(0, pointIndex));
    sceneObjects.points.add(new THREE.Points(pointsGeom, materials.point));

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

function drawVoronoi() {
    // Clear any previous visualizations
    while (sceneObjects.voronoiEdges.children.length) {
        sceneObjects.voronoiEdges.remove(sceneObjects.voronoiEdges.children[0]);
    }

    const finalTetras = delaunay.getTriangulation();
    const positions = [];
    const bounds = new THREE.Box3(
        new THREE.Vector3(-BOX_SIZE / 2, -BOX_SIZE / 2, -BOX_SIZE / 2),
        new THREE.Vector3(BOX_SIZE / 2, BOX_SIZE / 2, BOX_SIZE / 2)
    );

    // Reusable objects for calculation to improve performance
    const ray = new THREE.Ray();
    const intersectionPoint = new THREE.Vector3();

    // Iterate through all pairs of adjacent tetrahedra
    for (let i = 0; i < finalTetras.length; i++) {
        for (let j = i + 1; j < finalTetras.length; j++) {
            if (!finalTetras[i].isAdjacent(finalTetras[j])) continue;

            const c1 = finalTetras[i].circumcenter;
            const c2 = finalTetras[j].circumcenter;
            if (!c1 || !c2) continue;

            const isC1Inside = bounds.containsPoint(c1);
            const isC2Inside = bounds.containsPoint(c2);

            if (isC1Inside && isC2Inside) {
                // CASE 1: Both points are inside the box. Draw the full edge.
                positions.push(c1.x, c1.y, c1.z, c2.x, c2.y, c2.z);

            } else if (isC1Inside && !isC2Inside) {
                // CASE 2: One point is inside, one is outside. Find the intersection.
                ray.set(c1, c2.clone().sub(c1).normalize());
                if (ray.intersectBox(bounds, intersectionPoint)) {
                    positions.push(c1.x, c1.y, c1.z, intersectionPoint.x, intersectionPoint.y, intersectionPoint.z);
                }

            } else if (!isC1Inside && isC2Inside) {
                // CASE 2 (Reversed): The other point is inside. Find the intersection.
                ray.set(c2, c1.clone().sub(c2).normalize());
                if (ray.intersectBox(bounds, intersectionPoint)) {
                    positions.push(c2.x, c2.y, c2.z, intersectionPoint.x, intersectionPoint.y, intersectionPoint.z);
                }
            }
            // CASE 3: Both points are outside. We ignore this edge.
        }
    }

    const voronoiGeom = new THREE.BufferGeometry();
    voronoiGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    sceneObjects.voronoiEdges.add(new THREE.LineSegments(voronoiGeom, materials.voronoi));
}

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

class Tetrahedron {
    constructor(p1, p2, p3, p4) {
        this.points = [p1, p2, p3, p4];
        this.calcCircumsphere();
    }

    calcCircumsphere() {
        const a = this.points[0], b = this.points[1], c = this.points[2], d = this.points[3];
        
        const a_ = a.clone().sub(d);
        const b_ = b.clone().sub(d);
        const c_ = c.clone().sub(d);
        
        const A = a_.lengthSq();
        const B = b_.lengthSq();
        const C = c_.lengthSq();
        
        const M = new THREE.Matrix3();
        M.set(a_.x, a_.y, a_.z, b_.x, b_.y, b_.z, c_.x, c_.y, c_.z);
        
        const det = M.determinant();
        if (Math.abs(det) < 1e-12) { // Degenerate tetrahedron
            this.circumcenter = null;
            this.radiusSq = Infinity;
            return;
        }
        
        const invDet = 0.5 / det;
        
        const x = (A * (b_.y * c_.z - c_.y * b_.z) - B * (a_.y * c_.z - c_.y * a_.z) + C * (a_.y * b_.z - b_.y * a_.z)) * invDet;
        const y = (A * (b_.z * c_.x - c_.z * b_.x) - B * (a_.z * c_.x - c_.z * a_.x) + C * (a_.z * b_.x - b_.z * a_.x)) * invDet;
        const z = (A * (b_.x * c_.y - c_.x * b_.y) - B * (a_.x * c_.y - c_.x * a_.y) + C * (a_.x * b_.y - b_.x * a_.y)) * invDet;

        this.circumcenter = new THREE.Vector3(x, y, z).add(d);
        this.radiusSq = this.circumcenter.distanceToSquared(a);
    }
    
    containsPoint(p) {
        return this.points.some(v => v.equals(p));
    }

    circumsphereContains(p) {
        if (!this.circumcenter) return false;
        return p.distanceToSquared(this.circumcenter) < this.radiusSq;
    }

    getFaces() {
        const p = this.points;
        return [
            { a: p[0], b: p[1], c: p[2] }, { a: p[0], b: p[1], c: p[3] },
            { a: p[0], b: p[2], c: p[3] }, { a: p[1], b: p[2], c: p[3] }
        ];
    }
    
    isAdjacent(other) {
        let common = 0;
        for(const p1 of this.points) {
            for (const p2 of other.points) {
                if (p1.equals(p2)) common++;
            }
        }
        return common === 3;
    }
}

class Delaunay3D {
    constructor(size) {
        this.tetrahedra = [];
        // Create a large super-tetrahedron
        const s = size;
        const p1 = new THREE.Vector3(-s, -s, -s);
        const p2 = new THREE.Vector3(s, -s, 0);
        const p3 = new THREE.Vector3(0, s, -s);
        const p4 = new THREE.Vector3(0, -s, s);
        this.superPoints = [p1, p2, p3, p4];
        this.tetrahedra.push(new Tetrahedron(p1, p2, p3, p4));
    }

    addPoint(point) {
        const badTetras = this.tetrahedra.filter(tetra => tetra.circumsphereContains(point));
        this.tetrahedra = this.tetrahedra.filter(tetra => !tetra.circumsphereContains(point));

        const cavityFaces = [];
        const faceMap = new Map();

        badTetras.forEach(tetra => {
            tetra.getFaces().forEach(face => {
                const key = [face.a, face.b, face.c].map(p => `${p.x},${p.y},${p.z}`).sort().join('|');
                faceMap.has(key) ? faceMap.delete(key) : faceMap.set(key, face);
            });
        });

        faceMap.forEach(face => cavityFaces.push(face));
        
        const newTetras = [];
        cavityFaces.forEach(face => {
            const newTetra = new Tetrahedron(point, face.a, face.b, face.c);
            this.tetrahedra.push(newTetra);
            newTetras.push(newTetra);
        });

        return { badTetras, cavityFaces, newTetras };
    }

    getTriangulation() {
        return this.tetrahedra.filter(tetra =>
            !tetra.points.some(p => this.superPoints.includes(p))
        );
    }
}