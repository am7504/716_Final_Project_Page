import * as THREE from 'three';

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
        if (Math.abs(det) < 1e-8) { // Degenerate tetrahedron
            this.circumcenter = null;
            this.radiusSq = Infinity;
            return;
        }
        
        const invDet = 0.5 / det;
        //const invDet = 0.5 / Math.abs(det);
        
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
    
    //isAdjacent(other) {
    //    let common = 0;
    //    for(const p1 of this.points) {
    //        for (const p2 of other.points) {
    //            if (p1.equals(p2)) common++;
    //        }
    //    }
    //    return common === 3;
    //}

    isAdjacent(other) {
        let common = 0;
        for(const p1 of this.points) {
            for (const p2 of other.points) {
                if (p1.distanceTo(p2) < 1e-8) common++;
            }
        }
        return common === 3;
    }
}

export class Delaunay3D {
    constructor(size) {
        this.tetrahedra = [];
        // Create a large super-tetrahedron
        const s = size;
        //const p1 = new THREE.Vector3(-s, -s, -s);
        //const p2 = new THREE.Vector3(s, -s, 0);
        //const p3 = new THREE.Vector3(0, s, -s);
        //const p4 = new THREE.Vector3(0, -s, s);

        const p1 = new THREE.Vector3(-s, -s, -s);
        const p2 = new THREE.Vector3(s, -s, 0);
        const p3 = new THREE.Vector3(0, s, -s);
        const p4 = new THREE.Vector3(0, 0, s);

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