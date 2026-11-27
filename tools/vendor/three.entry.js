// three.js (MIT) for the 3D model preview (editor/renderers/model3d.ts) and its parse worker
// (editor/renderers/media/model3d-worker.js) and the robot preview (editor/renderers/urdf.ts): only the core classes, loaders and controls the
// preview uses, so esbuild tree-shakes the rest. Draco's pure-JS decoder (no WebAssembly, no eval)
// is copied next to this bundle as vendor/draco/draco_decoder.js by tools/build-vendor.mjs.
export {
  AmbientLight,
  AxesHelper,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Euler,
  Float32BufferAttribute,
  GridHelper,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  LoadingManager,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PMREMGenerator,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  REVISION,
  Raycaster,
  SRGBColorSpace,
  Scene,
  Sphere,
  SphereGeometry,
  Uint32BufferAttribute,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
export { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
export { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
export { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
export { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
export { TextureLoader } from 'three'
export { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
export { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
export { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
export { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
export { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
export { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
