import * as THREE from 'three';

const N = 10000;
const nodeList = [];
for (let i=0; i<N; i++) {
    nodeList.push({
        mesh: { position: new THREE.Vector3(Math.random()*100, Math.random()*100, Math.random()*100) },
        instanceId: i
    });
}

const matrixArray = new Float32Array(N * 16);
for(let i=0; i<N; i++) {
    matrixArray[i*16 + 12] = nodeList[i].mesh.position.x;
    matrixArray[i*16 + 13] = nodeList[i].mesh.position.y;
    matrixArray[i*16 + 14] = nodeList[i].mesh.position.z;
}

const graphCenter = new THREE.Vector3(50, 50, 50);

function benchOld() {
    let maxDistSq = 0;
    for (let i = 0; i < nodeList.length; i++) {
        const distSq = graphCenter.distanceToSquared(nodeList[i].mesh.position);
        if (distSq > maxDistSq) maxDistSq = distSq;
    }
    return maxDistSq;
}

function benchNewInstanceMatrix() {
    let maxDistSq = 0;
    const count = N;
    const arr = matrixArray;
    const cx = graphCenter.x, cy = graphCenter.y, cz = graphCenter.z;
    for (let i = 0; i < count; i++) {
        const idx = i * 16;
        const dx = cx - arr[idx + 12];
        const dy = cy - arr[idx + 13];
        const dz = cz - arr[idx + 14];
        const distSq = dx*dx + dy*dy + dz*dz;
        if (distSq > maxDistSq) maxDistSq = distSq;
    }
    return maxDistSq;
}

// Warmup
for(let i=0; i<100; i++) {
    benchOld();
    benchNewInstanceMatrix();
}

const t0 = performance.now();
for(let i=0; i<10000; i++) benchOld();
const t1 = performance.now();
for(let i=0; i<10000; i++) benchNewInstanceMatrix();
const t2 = performance.now();

console.log(`Old (object access): ${t1-t0}ms`);
console.log(`New (Instance array sequential access): ${t2-t1}ms`);
