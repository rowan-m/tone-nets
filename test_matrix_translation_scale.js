import * as THREE from 'three';
const mat = new THREE.Matrix4();
mat.makeTranslation(10, 20, 30);
const vec = new THREE.Vector3(2, 2, 2);
mat.scale(vec);
console.log(mat.elements[12], mat.elements[13], mat.elements[14]);
