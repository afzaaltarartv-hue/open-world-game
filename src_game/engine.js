import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Global Game State
const GAME_STATE = {
  IDLE: 'IDLE',
  WALK: 'WALK',
  ATTACK_1: 'ATTACK_1',
  ATTACK_2: 'ATTACK_2',
  ATTACK_3: 'ATTACK_3'
};

class OpenWorldGame {
  constructor() {
    this.container = document.getElementById('game-container');
    this.clock = new THREE.Clock();

    // Scene & Renderer
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // Sky blue
    this.scene.fog = new THREE.FogExp2(0x87ceeb, 0.012);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    // Player Physics & Transform
    this.player = new THREE.Group();
    this.player.position.set(0, 0, 0);
    this.scene.add(this.player);

    this.playerVelocity = new THREE.Vector3();
    this.verticalVelocity = 0;
    this.isGrounded = true;
    this.playerRadius = 0.45;
    this.playerHeight = 1.8;
    this.targetRotation = 0;
    this.moveSpeed = 4.2;

    // Controls Input State
    this.inputVector = new THREE.Vector2(0, 0);
    this.cameraYaw = 0;
    this.cameraPitch = 0.25; // slightly looking down
    this.cameraDistance = 4.2;
    this.targetCameraDistance = 4.2;

    // Combat & Animation State Machine
    this.currentState = GAME_STATE.IDLE;
    this.queuedAttack = null;
    this.attackLockTimer = 0;
    this.currentAttackDuration = 0;
    this.attackProgress = 0;
    this.comboCount = 0;

    // Animation System
    this.mixer = null;
    this.actions = {};
    this.activeAction = null;
    this.characterModel = null;
    this.loader = new GLTFLoader();

    // Environment Colliders
    this.colliders = [];

    // Particle FX
    this.hitEffects = [];

    // Initialize Subsystems
    this.setupLights();
    this.buildWorld();
    this.setupResize();

    // Load Default Character
    this.loadCharacterPackage('characters/default');

    // Start Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 0.5);
    hemiLight.position.set(0, 50, 0);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfffaed, 1.2);
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
    // Large Ground Plane
    const groundGeo = new THREE.PlaneGeometry(300, 300, 32, 32);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2e3a29, // Lush dark grass
      roughness: 0.85,
      metalness: 0.05
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // City Roads & Plazas (Asphalt & Markings)
    this.createRoad(0, 0, 24, 260, 0x222428); // Main Avenue North-South
    this.createRoad(0, 0, 260, 24, 0x222428); // Cross Boulevard East-West

    // Central Plaza Concrete Area
    const plazaGeo = new THREE.BoxGeometry(40, 0.2, 40);
    const plazaMat = new THREE.MeshStandardMaterial({ color: 0xd6d6ce, roughness: 0.7 });
    const plaza = new THREE.Mesh(plazaGeo, plazaMat);
    plaza.position.set(0, 0.1, 0);
    plaza.receiveShadow = true;
    this.scene.add(plaza);

    // Decorative Centerpiece / Fountain base
    const fountainGeo = new THREE.CylinderGeometry(4, 4.5, 1, 16);
    const fountainMat = new THREE.MeshStandardMaterial({ color: 0x8c92ac, roughness: 0.5 });
    const fountain = new THREE.Mesh(fountainGeo, fountainMat);
    fountain.position.set(0, 0.6, 0);
    fountain.castShadow = true;
    fountain.receiveShadow = true;
    this.scene.add(fountain);
    this.addBoxCollider(fountain.position, 8, 1.2, 8);

    // Test Elevation Ramp
    this.createRamp(0, 0.75, 25, 6, 1.5, 12, 0);
    // Elevated Platform
    const platGeo = new THREE.BoxGeometry(10, 1.5, 10);
    const platMat = new THREE.MeshStandardMaterial({ color: 0x7c8577 });
    const plat = new THREE.Mesh(platGeo, platMat);
    plat.position.set(0, 0.75, 36);
    plat.receiveShadow = true;
    plat.castShadow = true;
    this.scene.add(plat);
    this.addBoxCollider(plat.position, 10, 1.5, 10);

    // Buildings with Collision
    const buildingColors = [0x50657b, 0xa39171, 0x7d8288, 0x875549, 0x3d4a54];
    
    // North-West Block Buildings
    this.createBuilding(-30, 20, -30, 18, 28, 22, buildingColors[0]);
    this.createBuilding(-55, 15, -30, 16, 20, 20, buildingColors[1]);
    this.createBuilding(-30, 12, -60, 20, 18, 16, buildingColors[2]);

    // North-East Block Buildings
    this.createBuilding(35, 22, -35, 22, 32, 20, buildingColors[3]);
    this.createBuilding(65, 14, -35, 18, 20, 18, buildingColors[0]);
    this.createBuilding(35, 16, -65, 20, 24, 20, buildingColors[4]);

    // South-West Block Buildings
    this.createBuilding(-35, 18, 35, 20, 26, 24, buildingColors[4]);
    this.createBuilding(-65, 15, 35, 18, 22, 18, buildingColors[2]);

    // South-East Block Buildings
    this.createBuilding(40, 20, 40, 24, 30, 22, buildingColors[1]);
    this.createBuilding(70, 16, 40, 16, 22, 18, buildingColors[3]);

    // Obstacles: Wooden Crates & Shipping Containers
    this.createCrate(-8, 1, -8, 2, 2, 2);
    this.createCrate(-8, 3, -8, 1.8, 1.8, 1.8);
    this.createCrate(-6, 0.75, -8, 1.5, 1.5, 1.5);
    this.createCrate(10, 1, -12, 2, 2, 2);
    this.createCrate(14, 1.5, 8, 3, 3, 5, 0x2b4c7e); // Blue container
    this.createCrate(-16, 1.5, 12, 3, 3, 6, 0x9e2a2b); // Red container

    // Decorative Rocks & Trees
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const radius = 22 + (i % 3) * 6;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      // Don't place on roads
      if (Math.abs(x) > 13 || Math.abs(z) > 13) {
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

    // Dashed center markings
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
    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.6,
      metalness: 0.1
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, halfHeight, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Roof border
    const roofGeo = new THREE.BoxGeometry(w + 0.6, 0.8, d + 0.6);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1f2326, roughness: 0.9 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(x, halfHeight * 2 + 0.4, z);
    this.scene.add(roof);

    this.addBoxCollider(mesh.position, w, h, d);
  }

  createCrate(x, y, z, w, h, d, color = 0x8b5a2b) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const crate = new THREE.Mesh(geo, mat);
    crate.position.set(x, y, z);
    crate.castShadow = true;
    crate.receiveShadow = true;
    this.scene.add(crate);
    this.addBoxCollider(crate.position, w, h, d);
  }

  createRamp(x, y, z, w, h, l, angle) {
    const geo = new THREE.BoxGeometry(w, h, l);
    const mat = new THREE.MeshStandardMaterial({ color: 0x999988, roughness: 0.8 });
    const ramp = new THREE.Mesh(geo, mat);
    ramp.position.set(x, y, z);
    ramp.rotation.x = -0.15; // gentle slope
    ramp.receiveShadow = true;
    ramp.castShadow = true;
    this.scene.add(ramp);
  }

  createTree(x, z) {
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.5, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 1.75, z);
    trunk.castShadow = true;
    this.scene.add(trunk);

    const leavesGeo = new THREE.DodecahedronGeometry(2.2, 1);
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2e5c1e, roughness: 0.7 });
    const leaves = new THREE.Mesh(leavesGeo, leavesMat);
    leaves.position.set(x, 4.2, z);
    leaves.castShadow = true;
    this.scene.add(leaves);

    this.addBoxCollider(trunk.position, 1.0, 3.5, 1.0);
  }

  createRock(x, z) {
    const geo = new THREE.DodecahedronGeometry(1.2, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a7a7a, roughness: 0.9 });
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
    console.log('[OpenWorldGame] Loading character from:', baseDir);
    this.notifyStateChange('LOADING_CHARACTER', `Loading: ${baseDir}`);

    try {
      // Manifest load
      let manifest = {
        name: 'Character',
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
        console.warn('[OpenWorldGame] Using default manifest mapping:', e);
      }

      // Load 3D model
      const modelUrl = `${baseDir}/${manifest.model}`;
      const gltf = await this.loadGLTF(modelUrl);
      const newModel = gltf.scene;

      // Adjust model scale & shadow settings
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

      // Normalize bone names if needed
      const boneMap = new Set();
      newModel.traverse(node => {
        if (node.isBone) {
          boneMap.add(node.name);
        }
      });

      // Load Animation Clips
      const animKeys = ['idle', 'walk', 'attack1', 'attack2', 'attack3'];
      const loadedClips = {};

      for (const key of animKeys) {
        const animRelPath = manifest.animations[key];
        if (!animRelPath) {
          throw new Error(`Missing ${key} animation in manifest.`);
        }
        const animUrl = `${baseDir}/${animRelPath}`;
        try {
          const animGltf = await this.loadGLTF(animUrl);
          if (animGltf.animations && animGltf.animations.length > 0) {
            const clip = animGltf.animations[0];
            clip.name = key;
            this.normalizeTrackNames(clip, boneMap);
            loadedClips[key] = clip;
          } else {
            throw new Error(`No animation track found in ${animRelPath}`);
          }
        } catch (err) {
          console.error(`Failed to load animation ${key}:`, err);
          throw new Error(`Failed to load ${key} (${err.message})`);
        }
      }

      // Replace active character mesh & animation mixer
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

      // Listen for animation completion events for combat combo chaining
      this.mixer.addEventListener('finished', (e) => {
        this.onAnimationFinished(e.action);
      });

      // Set initial state to IDLE
      this.currentState = GAME_STATE.IDLE;
      this.activeAction = this.actions.idle;
      this.activeAction.play();

      console.log('[OpenWorldGame] Character loaded successfully:', manifest.name);
      if (window.AndroidBridge && window.AndroidBridge.onCharacterLoaded) {
        window.AndroidBridge.onCharacterLoaded(manifest.name);
      }
      this.notifyStateChange(this.currentState, `Loaded: ${manifest.name}`);

    } catch (error) {
      console.error('[OpenWorldGame] Character loading error:', error);
      if (window.AndroidBridge && window.AndroidBridge.onCharacterError) {
        window.AndroidBridge.onCharacterError(error.message || 'Unknown error loading character');
      }
      // If failed and not default, safely revert to default
      if (baseDir !== 'characters/default') {
        console.warn('[OpenWorldGame] Safely falling back to default character.');
        this.loadCharacterPackage('characters/default');
      }
    }
  }

  loadGLTF(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }

  normalizeTrackNames(clip, boneMap) {
    // Check if bones in model have prefix like "mixamorig:" while clip has "mixamorig" or vice versa
    clip.tracks.forEach(track => {
      const dotIndex = track.name.indexOf('.');
      if (dotIndex > 0) {
        const boneName = track.name.substring(0, dotIndex);
        const prop = track.name.substring(dotIndex);

        if (!boneMap.has(boneName)) {
          // Try adding or removing colon
          let candidate = boneName.replace('mixamorig:', 'mixamorig');
          if (boneMap.has(candidate)) {
            track.name = candidate + prop;
            return;
          }
          candidate = boneName.replace('mixamorig', 'mixamorig:');
          if (boneMap.has(candidate)) {
            track.name = candidate + prop;
            return;
          }
        }
      }
    });
  }

  // Animation Transition System with smooth cross-fade
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
    console.log('[OpenWorldGame] Attack triggered. Current state:', this.currentState);

    if (this.currentState === GAME_STATE.IDLE || this.currentState === GAME_STATE.WALK) {
      // Start combo: Attack 1 (Jab Cross)
      this.startAttack(GAME_STATE.ATTACK_1, 'attack1');
    } else if (this.currentState === GAME_STATE.ATTACK_1) {
      // Within combo window: Queue Attack 2 (Light Hit To Head)
      if (this.attackProgress >= 0.25 && this.attackProgress <= 0.85) {
        this.queuedAttack = { state: GAME_STATE.ATTACK_2, actionName: 'attack2' };
        console.log('[OpenWorldGame] Combo queued: ATTACK_2');
        this.spawnComboFeedback(2);
      }
    } else if (this.currentState === GAME_STATE.ATTACK_2) {
      // Within combo window: Queue Attack 3 (Punching)
      if (this.attackProgress >= 0.25 && this.attackProgress <= 0.85) {
        this.queuedAttack = { state: GAME_STATE.ATTACK_3, actionName: 'attack3' };
        console.log('[OpenWorldGame] Combo queued: ATTACK_3');
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

    // Spawn impact particles at character front
    this.spawnHitEffect();

    this.notifyStateChange(this.currentState, `Combo Hit: ${actionName.toUpperCase()}`);
  }

  onAnimationFinished(finishedAction) {
    // If attack finished
    if (this.isAttackState(this.currentState)) {
      if (this.queuedAttack) {
        const next = this.queuedAttack;
        this.startAttack(next.state, next.actionName);
      } else {
        // Return to IDLE or WALK based on joystick input
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

  // Visual Hit & Combo Effects
  spawnHitEffect() {
    const flashGeo = new THREE.SphereGeometry(0.35, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.9 });
    const flash = new THREE.Mesh(flashGeo, flashMat);

    // Position ~1.1m in front of player at chest height
    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.rotation.y);
    flash.position.copy(this.player.position).add(forward.multiplyScalar(0.9)).add(new THREE.Vector3(0, 1.3, 0));
    this.scene.add(flash);

    this.hitEffects.push({ mesh: flash, life: 0.25, maxLife: 0.25 });
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

    // If currently not attacking, update locomotion state
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

  rotateCamera(deltaX, deltaY) {
    this.cameraYaw -= deltaX * 0.005;
    this.cameraPitch = Math.max(-0.4, Math.min(1.1, this.cameraPitch + deltaY * 0.005));
  }

  // Physics & Collision Update
  updatePhysics(delta) {
    // Gravity & Ground Check
    this.verticalVelocity -= 18.0 * delta;
    let nextY = this.player.position.y + this.verticalVelocity * delta;

    let groundLevel = 0;
    // Check if on elevated platform or ramp
    if (this.player.position.z >= 31 && this.player.position.z <= 41 && Math.abs(this.player.position.x) <= 5) {
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

    // Locomotion relative to camera
    const inputLen = this.inputVector.length();
    if (inputLen > 0.05 && !this.isAttackState(this.currentState)) {
      // Calculate move direction relative to camera yaw
      const moveAngle = Math.atan2(this.inputVector.x, this.inputVector.y) + this.cameraYaw;
      const speed = Math.min(inputLen, 1.0) * this.moveSpeed;

      const moveX = Math.sin(moveAngle) * speed * delta;
      const moveZ = Math.cos(moveAngle) * speed * delta;

      // Smooth Character Facing Direction
      const targetAngle = moveAngle;
      let diff = targetAngle - this.player.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.player.rotation.y += diff * Math.min(1.0, delta * 12);

      // Environment Collision Test (Sphere vs Box)
      const nextPos = this.player.position.clone().add(new THREE.Vector3(moveX, 0, moveZ));
      let collided = false;

      for (const box of this.colliders) {
        // Expand box by player radius
        const expandedBox = box.clone().expandByScalar(this.playerRadius);
        if (expandedBox.containsPoint(nextPos)) {
          collided = true;
          // Slide along axes
          const testX = this.player.position.clone().add(new THREE.Vector3(moveX, 0, 0));
          const testZ = this.player.position.clone().add(new THREE.Vector3(0, 0, moveZ));
          if (!expandedBox.containsPoint(testX)) {
            this.player.position.x += moveX;
          } else if (!expandedBox.containsPoint(testZ)) {
            this.player.position.z += moveZ;
          }
          break;
        }
      }

      if (!collided) {
        this.player.position.x += moveX;
        this.player.position.z += moveZ;
      }
    } else if (this.isAttackState(this.currentState)) {
      // Slight forward momentum step during attack
      const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.rotation.y);
      const step = forward.multiplyScalar(delta * 0.8);
      this.player.position.add(step);
    }
  }

  // Third-Person Follow Camera Update
  updateCamera(delta) {
    const targetHeight = 1.4;
    const targetPos = this.player.position.clone().add(new THREE.Vector3(0, targetHeight, 0));

    // Calculate ideal camera position based on Yaw and Pitch
    const horizDist = this.cameraDistance * Math.cos(this.cameraPitch);
    const vertDist = this.cameraDistance * Math.sin(this.cameraPitch);

    const desiredX = targetPos.x - Math.sin(this.cameraYaw) * horizDist;
    const desiredY = Math.max(targetPos.y + vertDist, 0.4);
    const desiredZ = targetPos.z - Math.cos(this.cameraYaw) * horizDist;
    const desiredPos = new THREE.Vector3(desiredX, desiredY, desiredZ);

    // Smooth camera lag/follow
    this.camera.position.lerp(desiredPos, Math.min(1.0, delta * 10));
    this.camera.lookAt(targetPos);

    // Keep sunlight aligned with player to prevent shadow clipping
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

    // Update Animation Mixer
    if (this.mixer) {
      this.mixer.update(delta);
    }

    // Track Attack Progress
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

// Global API exposed to Android WebView
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
  rotateCamera: (dx, dy) => {
    if (window.gameInstance) window.gameInstance.rotateCamera(dx, dy);
  },
  loadCharacterPackage: (path) => {
    if (window.gameInstance) window.gameInstance.loadCharacterPackage(path);
  }
};
