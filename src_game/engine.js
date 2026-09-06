import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Global Game State Constants
const GAME_STATE = {
  IDLE: 'IDLE',
  WALK: 'WALK',
  ATTACK_1: 'ATTACK_1',
  ATTACK_2: 'ATTACK_2',
  ATTACK_3: 'ATTACK_3'
};

class OpenWorldGame {
  constructor() {
    this.container = document.getElementById('game-container') || document.getElementById('canvas-container') || document.body;
    this.clock = new THREE.Clock();

    // Scene & Renderer
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x7ec0ee); // Sky blue
    this.scene.fog = new THREE.FogExp2(0x7ec0ee, 0.012);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: false,
        powerPreference: 'low-power',
        failIfMajorPerformanceCaveat: false,
        precision: 'mediump',
        alpha: false,
        stencil: false,
        depth: true
      });
    } catch (e) {
      console.warn('Fallback WebGLRenderer initialization:', e);
      this.renderer = new THREE.WebGLRenderer();
    }
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    // Player Physics & Transform
    this.player = new THREE.Group();
    // Spawn at open plaza space, looking towards the plaza center
    this.player.position.set(0, 0.1, 14);
    this.scene.add(this.player);

    this.verticalVelocity = 0;
    this.isGrounded = true;
    this.playerRadius = 0.5;
    this.moveSpeed = 4.8;

    // Controls Input State
    this.inputVector = new THREE.Vector2(0, 0);
    this.smoothedInput = new THREE.Vector2(0, 0);
    this.cameraYaw = Math.PI; // Face forward into the open plaza
    this.cameraPitch = 0.28; // looking slightly down
    this.cameraDistance = 4.5;

    // Combat & Animation State Machine
    this.currentState = GAME_STATE.IDLE;
    this.queuedAttack = null;
    this.attackLockTimer = 0;
    this.currentAttackDuration = 0;
    this.attackProgress = 0;

    // Animation System
    this.mixer = null;
    this.actions = {};
    this.activeAction = null;
    this.characterModel = null;
    this.loader = new GLTFLoader();

    // Environment Colliders
    this.colliders = [];
    this.hitEffects = [];

    // Initialize Subsystems
    this.setupLights();
    this.buildWorld();
    this.setupResize();

    // Start with Default Packaged Character
    this.loadCharacterPackage('/assets/characters/default');

    // Start Main Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 0.45);
    hemiLight.position.set(0, 50, 0);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfff6e5, 1.3);
    dirLight.position.set(35, 60, 25);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 150;
    dirLight.shadow.camera.left = -40;
    dirLight.shadow.camera.right = 40;
    dirLight.shadow.camera.top = 40;
    dirLight.shadow.camera.bottom = -40;
    dirLight.shadow.bias = -0.001;
    this.scene.add(dirLight);
    this.sunLight = dirLight;
  }

  buildWorld() {
    // Large Ground Plane (Grass)
    const groundGeo = new THREE.PlaneGeometry(300, 300, 16, 16);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x3d5c2a, // Rich grass
      roughness: 0.9,
      metalness: 0.05
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // City Roads (Asphalt & Line Markings)
    this.createRoad(0, 0, 22, 260, 0x22252a);
    this.createRoad(0, 0, 260, 22, 0x22252a);

    // Central Plaza Stone Floor
    const plazaGeo = new THREE.BoxGeometry(40, 0.2, 40);
    const plazaMat = new THREE.MeshStandardMaterial({ color: 0xc4c7cc, roughness: 0.75 });
    const plaza = new THREE.Mesh(plazaGeo, plazaMat);
    plaza.position.set(0, 0.1, 0);
    plaza.receiveShadow = true;
    this.scene.add(plaza);

    // Center Monument Base (Cylinder Obstacle)
    const fountainGeo = new THREE.CylinderGeometry(3.5, 4.2, 1.2, 16);
    const fountainMat = new THREE.MeshStandardMaterial({ color: 0x6e7888, roughness: 0.6 });
    const fountain = new THREE.Mesh(fountainGeo, fountainMat);
    fountain.position.set(0, 0.7, 0);
    fountain.castShadow = true;
    fountain.receiveShadow = true;
    this.scene.add(fountain);
    this.addBoxCollider(fountain.position, 7.5, 1.4, 7.5);

    // Elevation Ramp to Raised Platform
    this.createRamp(0, 0.75, 25, 6, 1.5, 12);
    const platGeo = new THREE.BoxGeometry(12, 1.5, 12);
    const platMat = new THREE.MeshStandardMaterial({ color: 0x5a6358, roughness: 0.7 });
    const plat = new THREE.Mesh(platGeo, platMat);
    plat.position.set(0, 0.75, 37);
    plat.receiveShadow = true;
    plat.castShadow = true;
    this.scene.add(plat);
    this.addBoxCollider(plat.position, 12, 1.5, 12);

    // City Buildings (Modular Heights and Colors)
    const buildingColors = [0x41536b, 0x8a7960, 0x5c6670, 0x7a4b41, 0x333d45];

    // North-West Block
    this.createBuilding(-32, 16, -32, 18, 32, 20, buildingColors[0]);
    this.createBuilding(-56, 12, -32, 16, 24, 18, buildingColors[1]);
    this.createBuilding(-32, 10, -58, 20, 20, 16, buildingColors[2]);

    // North-East Block
    this.createBuilding(34, 18, -34, 20, 36, 18, buildingColors[3]);
    this.createBuilding(62, 11, -34, 18, 22, 18, buildingColors[0]);
    this.createBuilding(34, 14, -62, 18, 28, 18, buildingColors[4]);

    // South-West Block
    this.createBuilding(-34, 15, 34, 20, 30, 20, buildingColors[4]);
    this.createBuilding(-62, 12, 34, 18, 24, 18, buildingColors[2]);

    // South-East Block
    this.createBuilding(36, 17, 36, 22, 34, 20, buildingColors[1]);
    this.createBuilding(66, 13, 36, 16, 26, 18, buildingColors[3]);

    // Obstacles: Wooden Crates & Shipping Containers
    this.createCrate(-7, 1, -7, 2, 2, 2);
    this.createCrate(-7, 3, -7, 1.8, 1.8, 1.8);
    this.createCrate(-5, 0.75, -7, 1.5, 1.5, 1.5);
    this.createCrate(9, 1, -11, 2, 2, 2);
    this.createCrate(14, 1.5, 8, 3, 3, 6, 0x1f4477); // Blue container
    this.createCrate(-16, 1.5, 12, 3, 3, 6, 0x8a2325); // Red container

    // Trees and Boulders along sidewalks
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const radius = 22 + (i % 3) * 7;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (Math.abs(x) > 12 || Math.abs(z) > 12) {
        if (i % 2 === 0) {
          this.createTree(x, z);
        } else {
          this.createRock(x, z);
        }
      }
    }
  }

  createRoad(x, z, width, length, color) {
    const geo = new THREE.PlaneGeometry(width, length);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.02, z);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const isNS = length > width;
    const numDashes = Math.floor((isNS ? length : width) / 6);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
    for (let i = 0; i < numDashes; i++) {
      const dGeo = new THREE.PlaneGeometry(isNS ? 0.35 : 2.5, isNS ? 2.5 : 0.35);
      const dash = new THREE.Mesh(dGeo, dashMat);
      dash.rotation.x = -Math.PI / 2;
      const offset = (i - numDashes / 2) * 6;
      dash.position.set(isNS ? x : x + offset, 0.03, isNS ? z + offset : z);
      this.scene.add(dash);
    }
  }

  createBuilding(x, halfHeight, z, w, h, d, color) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, halfHeight, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Roof border trim
    const roofGeo = new THREE.BoxGeometry(w + 0.6, 0.8, d + 0.6);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1d2125, roughness: 0.9 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(x, halfHeight * 2 + 0.4, z);
    this.scene.add(roof);

    this.addBoxCollider(mesh.position, w, h, d);
  }

  createCrate(x, y, z, w, h, d, color = 0x7c4e24) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const crate = new THREE.Mesh(geo, mat);
    crate.position.set(x, y, z);
    crate.castShadow = true;
    crate.receiveShadow = true;
    this.scene.add(crate);
    this.addBoxCollider(crate.position, w, h, d);
  }

  createRamp(x, y, z, w, h, l) {
    const geo = new THREE.BoxGeometry(w, h, l);
    const mat = new THREE.MeshStandardMaterial({ color: 0x888877, roughness: 0.8 });
    const ramp = new THREE.Mesh(geo, mat);
    ramp.position.set(x, y, z);
    ramp.rotation.x = -0.15;
    ramp.receiveShadow = true;
    ramp.castShadow = true;
    this.scene.add(ramp);
  }

  createTree(x, z) {
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.5, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3328, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 1.75, z);
    trunk.castShadow = true;
    this.scene.add(trunk);

    const leavesGeo = new THREE.DodecahedronGeometry(2.3, 1);
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x245517, roughness: 0.75 });
    const leaves = new THREE.Mesh(leavesGeo, leavesMat);
    leaves.position.set(x, 4.3, z);
    leaves.castShadow = true;
    this.scene.add(leaves);

    this.addBoxCollider(trunk.position, 1.0, 3.5, 1.0);
  }

  createRock(x, z) {
    const geo = new THREE.DodecahedronGeometry(1.2, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6e6e6e, roughness: 0.9 });
    const rock = new THREE.Mesh(geo, mat);
    rock.position.set(x, 0.6, z);
    rock.scale.set(1.4, 0.8, 1.2);
    rock.castShadow = true;
    this.scene.add(rock);
    this.addBoxCollider(rock.position, 1.8, 1.2, 1.8);
  }

  addBoxCollider(pos, w, h, d) {
    const half = new THREE.Vector3(w / 2, h / 2, d / 2);
    const box = new THREE.Box3(
      new THREE.Vector3().subVectors(pos, half),
      new THREE.Vector3().addVectors(pos, half)
    );
    this.colliders.push(box);
  }

  // Load Character Model & Retarget Animations
  async loadCharacterPackage(baseDir) {
    console.log('[OpenWorldGame] Loading character package:', baseDir);
    this.notifyStateChange('LOADING', `Loading: ${baseDir}`);

    try {
      let manifest = {
        name: 'Mutant (Default)',
        model: 'model/character.glb',
        animations: {
          idle: 'animations/idle.glb',
          walk: 'animations/walk.glb',
          attack1: 'animations/attack1.glb',
          attack2: 'animations/attack2.glb',
          attack3: 'animations/attack3.glb'
        }
      };

      try {
        const res = await fetch(`${baseDir}/manifest.json`);
        if (res.ok) {
          manifest = await res.json();
        }
      } catch (e) {
        console.warn('[OpenWorldGame] Manifest fetch error, fallback to defaults:', e);
      }

      // Load 3D model
      const modelUrl = `${baseDir}/${manifest.model}`;
      const gltf = await this.loadGLTF(modelUrl);
      const newModel = gltf.scene;

      newModel.traverse(node => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          if (node.material) {
            node.material.roughness = 0.6;
            node.material.metalness = 0.1;
          }
        }
      });

      // Gather bone names for retargeting
      const boneMap = new Set();
      newModel.traverse(node => {
        if (node.isBone) {
          boneMap.add(node.name);
        }
      });

      // Load Animations
      const animKeys = ['idle', 'walk', 'attack1', 'attack2', 'attack3'];
      const loadedClips = {};

      for (const key of animKeys) {
        const animRelPath = manifest.animations ? manifest.animations[key] : null;
        if (!animRelPath) {
          throw new Error(`Missing ${key} animation in manifest.`);
        }
        const animUrl = `${baseDir}/${animRelPath}`;
        try {
          const animGltf = await this.loadGLTF(animUrl);
          if (animGltf.animations && animGltf.animations.length > 0) {
            const clip = animGltf.animations[0];
            clip.name = key;
            const isLocomotion = (key === 'walk' || key === 'idle');
            this.normalizeTrackNames(clip, boneMap, isLocomotion);
            loadedClips[key] = clip;
          } else {
            throw new Error(`No animation track found in ${animRelPath}`);
          }
        } catch (err) {
          console.error(`Failed loading animation ${key}:`, err);
          throw new Error(`Animation ${key} failed to load (${err.message})`);
        }
      }

      // Cleanup previous character
      if (this.characterModel) {
        this.player.remove(this.characterModel);
        if (this.mixer) {
          this.mixer.stopAllAction();
          this.mixer.uncacheRoot(this.characterModel);
        }
      }

      this.characterModel = newModel;
      this.player.add(this.characterModel);

      this.mixer = new THREE.AnimationMixer(this.characterModel);
      this.actions = {};

      for (const key of animKeys) {
        const clip = loadedClips[key];
        const action = this.mixer.clipAction(clip);
        if (key === 'idle' || key === 'walk') {
          action.setLoop(THREE.LoopRepeat, Infinity);
        } else {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = false;
        }
        this.actions[key] = action;
      }

      this.mixer.addEventListener('finished', (e) => {
        this.onAnimationFinished(e.action);
      });

      // Start in IDLE state
      this.currentState = GAME_STATE.IDLE;
      this.activeAction = this.actions.idle;
      this.activeAction.play();

      console.log('[OpenWorldGame] Successfully loaded:', manifest.name);
      if (window.AndroidBridge && window.AndroidBridge.onCharacterLoaded) {
        window.AndroidBridge.onCharacterLoaded(manifest.name);
      }
      this.notifyStateChange(this.currentState, manifest.name);

    } catch (error) {
      console.error('[OpenWorldGame] Character load error:', error);
      if (window.AndroidBridge && window.AndroidBridge.onCharacterError) {
        window.AndroidBridge.onCharacterError(error.message || 'Error loading character mod');
      }
      // Revert safely to default if not already default
      if (baseDir !== '/assets/characters/default') {
        console.warn('[OpenWorldGame] Reverting safely to default Mutant character');
        this.loadCharacterPackage('/assets/characters/default');
      }
    }
  }

  loadGLTF(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }

  normalizeTrackNames(clip, boneMap, isLocomotion = false) {
    clip.tracks.forEach(track => {
      const dotIndex = track.name.indexOf('.');
      if (dotIndex > 0) {
        const boneName = track.name.substring(0, dotIndex);
        const prop = track.name.substring(dotIndex);

        if (!boneMap.has(boneName)) {
          let candidate = boneName.replace('mixamorig:', 'mixamorig');
          if (boneMap.has(candidate)) {
            track.name = candidate + prop;
          } else {
            candidate = boneName.replace('mixamorig', 'mixamorig:');
            if (boneMap.has(candidate)) {
              track.name = candidate + prop;
            }
          }
        }
      }

      // If this is a locomotion/walking animation, neutralize root horizontal translation (X and Z)
      // to eliminate root motion snapping while preserving natural vertical hip bobbing (Y).
      if (isLocomotion && track.name.endsWith('.position')) {
        const vals = track.values;
        const count = vals.length / 3;
        for (let i = 0; i < count; i++) {
          vals[i * 3] = 0;     // X offset centered
          vals[i * 3 + 2] = 0; // Z offset centered (prevents snap back upon loop)
        }
      }
    });
  }

  fadeToAction(name, duration = 0.18) {
    const nextAction = this.actions[name];
    if (!nextAction || nextAction === this.activeAction) return;

    nextAction.reset();
    nextAction.fadeIn(duration).play();

    if (this.activeAction) {
      this.activeAction.fadeOut(duration);
    }
    this.activeAction = nextAction;
  }

  // Melee Combat Combo Trigger
  triggerAttack() {
    if (this.currentState === GAME_STATE.IDLE || this.currentState === GAME_STATE.WALK) {
      this.startAttack(GAME_STATE.ATTACK_1, 'attack1');
    } else if (this.currentState === GAME_STATE.ATTACK_1) {
      if (this.attackProgress >= 0.25 && this.attackProgress <= 0.85) {
        this.queuedAttack = { state: GAME_STATE.ATTACK_2, actionName: 'attack2' };
        this.spawnComboFeedback(2);
      }
    } else if (this.currentState === GAME_STATE.ATTACK_2) {
      if (this.attackProgress >= 0.25 && this.attackProgress <= 0.85) {
        this.queuedAttack = { state: GAME_STATE.ATTACK_3, actionName: 'attack3' };
        this.spawnComboFeedback(3);
      }
    }
  }

  startAttack(state, actionName) {
    this.currentState = state;
    this.queuedAttack = null;
    this.attackProgress = 0;
    this.fadeToAction(actionName, 0.12);

    const action = this.actions[actionName];
    this.currentAttackDuration = action ? action.getClip().duration : 0.8;
    this.attackLockTimer = this.currentAttackDuration;

    this.spawnHitEffect();
    this.notifyStateChange(this.currentState, `Combo: ${actionName.toUpperCase()}`);
  }

  onAnimationFinished(action) {
    if (this.isAttackState(this.currentState)) {
      if (this.queuedAttack) {
        const next = this.queuedAttack;
        this.startAttack(next.state, next.actionName);
      } else {
        this.returnToLocomotion();
      }
    }
  }

  returnToLocomotion() {
    this.queuedAttack = null;
    if (this.inputVector.length() > 0.05) {
      this.currentState = GAME_STATE.WALK;
      this.fadeToAction('walk', 0.2);
    } else {
      this.currentState = GAME_STATE.IDLE;
      this.fadeToAction('idle', 0.2);
    }
    this.notifyStateChange(this.currentState, 'Ready');
  }

  isAttackState(state) {
    return state === GAME_STATE.ATTACK_1 || state === GAME_STATE.ATTACK_2 || state === GAME_STATE.ATTACK_3;
  }

  spawnHitEffect() {
    const flashGeo = new THREE.SphereGeometry(0.35, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.9 });
    const flash = new THREE.Mesh(flashGeo, flashMat);

    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.rotation.y);
    flash.position.copy(this.player.position).add(forward.multiplyScalar(0.9)).add(new THREE.Vector3(0, 1.3, 0));
    this.scene.add(flash);

    this.hitEffects.push({ mesh: flash, life: 0.22, maxLife: 0.22 });
  }

  spawnComboFeedback(hitNumber) {
    if (window.AndroidBridge && window.AndroidBridge.onComboQueued) {
      window.AndroidBridge.onComboQueued(hitNumber);
    }
  }

  notifyStateChange(state, message = '') {
    if (window.AndroidBridge && window.AndroidBridge.onGameStateChanged) {
      window.AndroidBridge.onGameStateChanged(JSON.stringify({
        state: state,
        message: message,
        combo: this.currentState
      }));
    }
  }

  // Touch Controls Handlers
  setJoystickInput(x, y) {
    this.inputVector.set(x, y);

    if (!this.isAttackState(this.currentState)) {
      if (this.inputVector.length() > 0.05) {
        if (this.currentState !== GAME_STATE.WALK) {
          this.currentState = GAME_STATE.WALK;
          this.fadeToAction('walk', 0.2);
          this.notifyStateChange(this.currentState);
        }
      } else {
        if (this.currentState !== GAME_STATE.IDLE) {
          this.currentState = GAME_STATE.IDLE;
          this.fadeToAction('idle', 0.2);
          this.notifyStateChange(this.currentState);
        }
      }
    }
  }

  triggerJump() {
    if (this.isGrounded) {
      this.verticalVelocity = 7.0;
      this.isGrounded = false;
    }
  }

  rotateCamera(deltaX, deltaY) {
    this.cameraYaw -= deltaX * 0.005;
    this.cameraPitch = Math.max(-0.35, Math.min(1.05, this.cameraPitch + deltaY * 0.005));
  }

  updatePhysics(delta) {
    // Gravity & Ground Height
    this.verticalVelocity -= 18.0 * delta;
    let nextY = this.player.position.y + this.verticalVelocity * delta;

    let groundLevel = 0;
    if (this.player.position.z >= 31 && this.player.position.z <= 43 && Math.abs(this.player.position.x) <= 6) {
      groundLevel = 1.5;
    } else if (this.player.position.z >= 19 && this.player.position.z < 31 && Math.abs(this.player.position.x) <= 3) {
      const t = (this.player.position.z - 19) / 12;
      groundLevel = t * 1.5;
    }

    if (nextY <= groundLevel) {
      nextY = groundLevel;
      this.verticalVelocity = 0;
      this.isGrounded = true;
    }
    this.player.position.y = nextY;

    // Smooth input interpolation for silky smooth acceleration and transitions
    const lerpFactor = Math.min(1.0, delta * 15.0);
    this.smoothedInput.lerp(this.inputVector, lerpFactor);

    // Movement relative to camera heading
    const inputLen = this.smoothedInput.length();
    if (inputLen > 0.04 && !this.isAttackState(this.currentState)) {
      // Joystick: x is horizontal (-1 left, +1 right), y is forward (+1 forward, -1 backward)
      // Camera heading: cameraYaw is where camera is looking from / facing
      const moveAngle = Math.atan2(this.smoothedInput.x, this.smoothedInput.y) + this.cameraYaw;
      const speed = Math.min(inputLen, 1.0) * this.moveSpeed;

      const moveX = Math.sin(moveAngle) * speed * delta;
      const moveZ = Math.cos(moveAngle) * speed * delta;

      // Smoothly rotate character toward movement heading without jitter
      let diff = moveAngle - this.player.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.player.rotation.y += diff * Math.min(1.0, delta * 14);

      // Robust Collision Resolution: Test X and Z movements independently to allow sliding along walls
      const rad = this.playerRadius;

      // 1. Try X movement
      let canMoveX = true;
      const testPosX = this.player.position.x + moveX;
      const currentZ = this.player.position.z;
      for (const box of this.colliders) {
        if (
          testPosX + rad > box.min.x &&
          testPosX - rad < box.max.x &&
          currentZ + rad > box.min.z &&
          currentZ - rad < box.max.z
        ) {
          canMoveX = false;
          break;
        }
      }
      if (canMoveX) {
        this.player.position.x += moveX;
      }

      // 2. Try Z movement
      let canMoveZ = true;
      const currentX = this.player.position.x;
      const testPosZ = this.player.position.z + moveZ;
      for (const box of this.colliders) {
        if (
          currentX + rad > box.min.x &&
          currentX - rad < box.max.x &&
          testPosZ + rad > box.min.z &&
          testPosZ - rad < box.max.z
        ) {
          canMoveZ = false;
          break;
        }
      }
      if (canMoveZ) {
        this.player.position.z += moveZ;
      }

      // 3. Safety Penetration Resolution: If player ever intersects an obstacle bounding box, push them out
      for (const box of this.colliders) {
        const px = this.player.position.x;
        const pz = this.player.position.z;
        if (
          px + rad > box.min.x &&
          px - rad < box.max.x &&
          pz + rad > box.min.z &&
          pz - rad < box.max.z
        ) {
          const overlapLeft = (px + rad) - box.min.x;
          const overlapRight = box.max.x - (px - rad);
          const overlapBottom = (pz + rad) - box.min.z;
          const overlapTop = box.max.z - (pz - rad);
          const minOverlap = Math.min(overlapLeft, overlapRight, overlapBottom, overlapTop);

          if (minOverlap === overlapLeft) {
            this.player.position.x = box.min.x - rad - 0.01;
          } else if (minOverlap === overlapRight) {
            this.player.position.x = box.max.x + rad + 0.01;
          } else if (minOverlap === overlapBottom) {
            this.player.position.z = box.min.z - rad - 0.01;
          } else {
            this.player.position.z = box.max.z + rad + 0.01;
          }
        }
      }
    } else if (this.isAttackState(this.currentState)) {
      // Forward momentum during attack swing
      const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.rotation.y);
      const step = forward.multiplyScalar(delta * 0.7);
      this.player.position.add(step);
    }
  }

  updateCamera(delta) {
    const targetHeight = 1.4;
    const targetPos = this.player.position.clone().add(new THREE.Vector3(0, targetHeight, 0));

    const horizDist = this.cameraDistance * Math.cos(this.cameraPitch);
    const vertDist = this.cameraDistance * Math.sin(this.cameraPitch);

    const desiredX = targetPos.x - Math.sin(this.cameraYaw) * horizDist;
    const desiredY = Math.max(targetPos.y + vertDist, 0.4);
    const desiredZ = targetPos.z - Math.cos(this.cameraYaw) * horizDist;
    const desiredPos = new THREE.Vector3(desiredX, desiredY, desiredZ);

    this.camera.position.lerp(desiredPos, Math.min(1.0, delta * 10));
    this.camera.lookAt(targetPos);

    if (this.sunLight) {
      this.sunLight.position.set(this.player.position.x + 35, 60, this.player.position.z + 25);
      this.sunLight.target.position.copy(this.player.position);
      this.sunLight.target.updateMatrixWorld();
    }
  }

  updateHitEffects(delta) {
    for (let i = this.hitEffects.length - 1; i >= 0; i--) {
      const eff = this.hitEffects[i];
      eff.life -= delta;
      eff.mesh.scale.multiplyScalar(1.08);
      eff.mesh.material.opacity = eff.life / eff.maxLife;
      if (eff.life <= 0) {
        this.scene.remove(eff.mesh);
        eff.mesh.geometry.dispose();
        eff.mesh.material.dispose();
        this.hitEffects.splice(i, 1);
      }
    }
  }

  setupResize() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  animate() {
    requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.1);

    if (this.mixer) {
      this.mixer.update(delta);
    }

    if (this.isAttackState(this.currentState)) {
      this.attackLockTimer -= delta;
      this.attackProgress = 1.0 - Math.max(0, this.attackLockTimer / this.currentAttackDuration);
      if (this.attackLockTimer <= 0) {
        this.returnToLocomotion();
      }
    }

    this.updatePhysics(delta);
    this.updateCamera(delta);
    this.updateHitEffects(delta);

    this.renderer.render(this.scene, this.camera);
  }
}

window.initGame = () => {
  window.gameInstance = new OpenWorldGame();
};

window.GameAPI = {
  setJoystick: (x, y) => {
    if (window.gameInstance) window.gameInstance.setJoystickInput(x, y);
  },
  triggerAttack: () => {
    if (window.gameInstance) window.gameInstance.triggerAttack();
  },
  triggerJump: () => {
    if (window.gameInstance) window.gameInstance.triggerJump();
  },
  rotateCamera: (dx, dy) => {
    if (window.gameInstance) window.gameInstance.rotateCamera(dx, dy);
  },
  loadCharacterPackage: (path) => {
    if (window.gameInstance) window.gameInstance.loadCharacterPackage(path);
  }
};
