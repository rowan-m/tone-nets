import * as THREE from 'three';

const N = 10000;
const nodeList = [];
for (let i=0; i<N; i++) {
    nodeList.push({
        mesh: { position: new THREE.Vector3(Math.random()*100, Math.random()*100, Math.random()*100) },
        instanceId: i
    });
}

function benchOld() {
    let sumX = 0, sumY = 0, sumZ = 0;
    for (let i = 0; i < nodeList.length; i++) {
        const nodeData = nodeList[i];
        sumX += nodeData.mesh.position.x;
        sumY += nodeData.mesh.position.y;
        sumZ += nodeData.mesh.position.z;
    }
    const cx = sumX / N;
    const cy = sumY / N;
    const cz = sumZ / N;

    let maxDistSq = 0;
    for (let i = 0; i < nodeList.length; i++) {
        const nodeData = nodeList[i];
        const dx = cx - nodeData.mesh.position.x;
        const dy = cy - nodeData.mesh.position.y;
        const dz = cz - nodeData.mesh.position.z;
        const distSq = dx*dx + dy*dy + dz*dz;
        if (distSq > maxDistSq) maxDistSq = distSq;
    }
    return Math.sqrt(maxDistSq);
}

const matrixArray = new Float32Array(N * 16);
for(let i=0; i<N; i++) {
    matrixArray[i*16 + 12] = nodeList[i].mesh.position.x;
    matrixArray[i*16 + 13] = nodeList[i].mesh.position.y;
    matrixArray[i*16 + 14] = nodeList[i].mesh.position.z;
}

function benchNewInstanceMatrix() {
    let sumX = 0, sumY = 0, sumZ = 0;
    const count = N; // Assume nodes.size === nodeInstancedMesh.count
    const arr = matrixArray;

    // Instead of using nodeData.mesh.position, read directly from matrix
    for (let i = 0; i < count; i++) {
        const idx = i * 16;
        sumX += arr[idx + 12];
        sumY += arr[idx + 13];
        sumZ += arr[idx + 14];
    }
    const cx = sumX / count;
    const cy = sumY / count;
    const cz = sumZ / count;

    let maxDistSq = 0;
    for (let i = 0; i < count; i++) {
        const idx = i * 16;
        const dx = cx - arr[idx + 12];
        const dy = cy - arr[idx + 13];
        const dz = cz - arr[idx + 14];
        const distSq = dx*dx + dy*dy + dz*dz;
        if (distSq > maxDistSq) maxDistSq = distSq;
    }
    return Math.sqrt(maxDistSq);
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
