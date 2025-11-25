import * as THREE from 'three';

export const clipPlanes = box => [
    new THREE.Plane(new THREE.Vector3( 1,  0,  0),  box.max.x),
    new THREE.Plane(new THREE.Vector3(-1,  0,  0), -box.min.x),
    new THREE.Plane(new THREE.Vector3( 0,  1,  0),  box.max.y),
    new THREE.Plane(new THREE.Vector3( 0, -1,  0), -box.min.y),
    new THREE.Plane(new THREE.Vector3( 0,  0,  1),  box.max.z),
    new THREE.Plane(new THREE.Vector3( 0,  0, -1), -box.min.z),
];

export const clipMesh = (region, box) => {
    // clone the region's geometry
    let geometry = region.geometry.clone();
    // for each plane...
    for (const plane of clipPlanes(box)) {
        // clip the geometry
        geometry = clipGeometryByPlane(geometry, plane);
        // if the region was fully remove, return null
        if (!geometry || geometry.attributes.position.count === 0) return null;
    };
    // create new mesh, from clipped geometry
    const clippedRegion = new THREE.Mesh(geometry, region.material.clone());
    // --
    return clippedRegion;
};

const dist = (i, pos, plane) => {
    const v = new THREE.Vector3();
    v.fromBufferAttribute(pos, i);
    return plane.distanceToPoint(v);
};

function clipGeometryByPlane(geometry, plane) {
    const pos = geometry.attributes.position;
    const index = geometry.index;
    const vertices = [];
    const newIndices = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();

    const addVertex = (v) => {
        vertices.push(v.x, v.y, v.z);
        return vertices.length / 3 - 1; // new index
    };

    const oldIndices = index ? index.array : null;
    const numTriangles = (oldIndices ? oldIndices.length : pos.count) / 3;

    for (let t = 0; t < numTriangles; t++) {
        const i0 = oldIndices ? oldIndices[t * 3 + 0] : t * 3 + 0;
        const i1 = oldIndices ? oldIndices[t * 3 + 1] : t * 3 + 1;
        const i2 = oldIndices ? oldIndices[t * 3 + 2] : t * 3 + 2;

        a.fromBufferAttribute(pos, i0);
        b.fromBufferAttribute(pos, i1);
        c.fromBufferAttribute(pos, i2);

        const d0 = dist(i0, pos, plane);
        const d1 = dist(i1, pos, plane);
        const d2 = dist(i2, pos, plane);

        const inside = [d0 >= 0, d1 >= 0, d2 >= 0];

        // All inside → keep triangle
        if (inside[0] && inside[1] && inside[2]) {
            newIndices.push(
                addVertex(a), addVertex(b), addVertex(c)
            );
            continue;
        }

        // All outside → discard
        if (!inside[0] && !inside[1] && !inside[2]) continue;

        // One or two vertices inside → clip
        const verts = [a, b, c];
        const dists = [d0, d1, d2];
        const newVerts = [];

        for (let i = 0; i < 3; i++) {
            const j = (i + 1) % 3;
            const v1 = verts[i], v2 = verts[j];
            const d1 = dists[i], d2 = dists[j];

            if (d1 >= 0) newVerts.push(v1.clone());

            if ((d1 >= 0 && d2 < 0) || (d1 < 0 && d2 >= 0)) {
                // intersect edge with plane
                const t = d1 / (d1 - d2);
                const inter = new THREE.Vector3().lerpVectors(v1, v2, t);
                newVerts.push(inter);
            }
        }

        // Triangulate the resulting polygon (3 or 4 verts)
        for (let i = 1; i < newVerts.length - 1; i++) {
            newIndices.push(
                addVertex(newVerts[0]),
                addVertex(newVerts[i]),
                addVertex(newVerts[i + 1])
            );
        };
    };
    // --
    if (newIndices.length === 0) return null;
    // --
    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    newGeom.setIndex(newIndices);
    newGeom.computeVertexNormals();
    // --
    return newGeom;
};