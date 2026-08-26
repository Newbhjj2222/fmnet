// components/ThreePitch.jsx

import {
  useEffect,
  useRef,
  useCallback
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

export default function ThreePitch({
  homeXI = [],
  awayXI = [],
  homeColor = "#2563eb",
  awayColor = "#dc2626",
  formation = "4-4-2",
  simulation = null,
}) {
  const mountRef = useRef(null);

  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);

  const homePlayersRef = useRef(new Map());
  const awayPlayersRef = useRef(new Map());

  const targetPlayersRef = useRef({
    home: new Map(),
    away: new Map(),
  });

  const ballRef = useRef(null);
  const ballStateRef = useRef(null);

  const animationFrameRef = useRef(null);

  // ============================================================
  // PLAYER NAME
  // ============================================================

  function getPlayerName(player) {
    return (
      player?.name ||
      player?.fullName ||
      `${player?.firstName || ""} ${player?.lastName || ""}`.trim() ||
      "Player"
    );
  }

  function getPlayerId(player, index) {
    return (
      player?.id ||
      player?.playerId ||
      player?.uid ||
      `${getPlayerName(player)}-${index}`
    );
  }

  // ============================================================
  // FORMATIONS
  // ============================================================

  function getFormationPositions(name) {
    const formations = {
      "4-4-2": [
        [-13, 0],
        [-9, -7],
        [-9, -2.4],
        [-9, 2.4],
        [-9, 7],

        [-3.5, -7],
        [-3.5, -2.3],
        [-3.5, 2.3],
        [-3.5, 7],

        [4.5, -3.2],
        [4.5, 3.2],
      ],

      "4-3-3": [
        [-13, 0],

        [-9, -7],
        [-9, -2.4],
        [-9, 2.4],
        [-9, 7],

        [-3.2, -5.5],
        [-3.2, 0],
        [-3.2, 5.5],

        [5, -6.5],
        [6, 0],
        [5, 6.5],
      ],

      "3-5-2": [
        [-13, 0],

        [-9, -5.5],
        [-9, 0],
        [-9, 5.5],

        [-3.2, -8],
        [-3.2, -4],
        [-3.2, 0],
        [-3.2, 4],
        [-3.2, 8],

        [5, -3.2],
        [5, 3.2],
      ],

      "5-3-2": [
        [-13, 0],

        [-9, -8],
        [-9, -4],
        [-9, 0],
        [-9, 4],
        [-9, 8],

        [-3.2, -5],
        [-3.2, 0],
        [-3.2, 5],

        [5, -3],
        [5, 3],
      ],

      "4-2-3-1": [
        [-13, 0],

        [-9, -7],
        [-9, -2.4],
        [-9, 2.4],
        [-9, 7],

        [-3.5, -3],
        [-3.5, 3],

        [1, -6],
        [2, 0],
        [1, 6],

        [5.5, 0],
      ],
    };

    return formations[name] || formations["4-4-2"];
  }

  // ============================================================
  // CREATE PLAYER
  // ============================================================

  function createPlayer(player, color, team, index) {
    const group = new THREE.Group();

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.5,
      metalness: 0.05,
    });

    const skinMaterial = new THREE.MeshStandardMaterial({
      color: 0xffc79b,
      roughness: 0.8,
    });

    // Body
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.48, 4, 10),
      bodyMaterial
    );

    body.position.y = 0.48;
    body.castShadow = true;

    group.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 16),
      skinMaterial
    );

    head.position.y = 0.92;
    head.castShadow = true;

    group.add(head);

    // Legs
    const legMaterial = new THREE.MeshStandardMaterial({
      color: 0x111827,
    });

    const leftLeg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.08, 0.35, 8),
      legMaterial
    );

    const rightLeg = leftLeg.clone();

    leftLeg.position.set(-0.11, 0.15, 0);
    rightLeg.position.set(0.11, 0.15, 0);

    group.add(leftLeg);
    group.add(rightLeg);

    // Player ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.47, 24),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.65,
      })
    );

    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;

    group.add(ring);

    group.userData.playerId = getPlayerId(player, index);
    group.userData.team = team;
    group.userData.name = getPlayerName(player);

    return group;
  }

  // ============================================================
  // CREATE PITCH
  // ============================================================

  useEffect(() => {
    if (!mountRef.current) return;

    const mount = mountRef.current;

    const width = mount.clientWidth || 900;
    const height = mount.clientHeight || 520;

    // ----------------------------------------------------------
    // SCENE
    // ----------------------------------------------------------

    const scene = new THREE.Scene();

    scene.background = new THREE.Color(0x07111f);

    sceneRef.current = scene;

    // ----------------------------------------------------------
    // CAMERA
    // ----------------------------------------------------------

    const camera = new THREE.PerspectiveCamera(
      42,
      width / height,
      0.1,
      200
    );

    camera.position.set(0, 24, 25);
    camera.lookAt(0, 0, 0);

    cameraRef.current = camera;

    // ----------------------------------------------------------
    // RENDERER
    // ----------------------------------------------------------

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });

    renderer.setSize(width, height);

    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, 2)
    );

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    renderer.outputColorSpace = THREE.SRGBColorSpace;

    mount.appendChild(renderer.domElement);

    rendererRef.current = renderer;

    // ----------------------------------------------------------
    // CONTROLS
    // ----------------------------------------------------------

    const controls = new OrbitControls(
      camera,
      renderer.domElement
    );

    controls.enableDamping = true;
    controls.dampingFactor = 0.06;

    controls.target.set(0, 0, 0);

    controls.minDistance = 15;
    controls.maxDistance = 42;

    controls.maxPolarAngle = Math.PI / 2.25;

    controls.enablePan = false;

    controls.update();

    controlsRef.current = controls;

    // ----------------------------------------------------------
    // LIGHTS
    // ----------------------------------------------------------

    const ambientLight = new THREE.AmbientLight(
      0xffffff,
      1.1
    );

    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(
      0xffffff,
      1.6
    );

    directionalLight.position.set(
      5,
      30,
      10
    );

    directionalLight.castShadow = true;

    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;

    scene.add(directionalLight);

    // ----------------------------------------------------------
    // PITCH
    // ----------------------------------------------------------

    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 20),
      new THREE.MeshStandardMaterial({
        color: 0x166534,
        roughness: 0.9,
      })
    );

    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;

    scene.add(pitch);

    // ----------------------------------------------------------
    // PITCH LINES
    // ----------------------------------------------------------

    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
    });

    function addLine(points) {
      const geometry =
        new THREE.BufferGeometry().setFromPoints(points);

      const line = new THREE.Line(
        geometry,
        lineMaterial
      );

      scene.add(line);

      return line;
    }

    // Outer border
    addLine([
      new THREE.Vector3(-15, 0.03, -10),
      new THREE.Vector3(15, 0.03, -10),
      new THREE.Vector3(15, 0.03, 10),
      new THREE.Vector3(-15, 0.03, 10),
      new THREE.Vector3(-15, 0.03, -10),
    ]);

    // Halfway line
    addLine([
      new THREE.Vector3(0, 0.03, -10),
      new THREE.Vector3(0, 0.03, 10),
    ]);

    // Center circle
    const centerCircle = new THREE.Mesh(
      new THREE.RingGeometry(3, 3.05, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
      })
    );

    centerCircle.rotation.x = -Math.PI / 2;
    centerCircle.position.y = 0.04;

    scene.add(centerCircle);

    // Center spot
    const centerSpot = new THREE.Mesh(
      new THREE.CircleGeometry(0.12, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
      })
    );

    centerSpot.rotation.x = -Math.PI / 2;
    centerSpot.position.y = 0.04;

    scene.add(centerSpot);

    // Penalty areas
    function createPenaltyArea(side) {
      const x1 = side === "left" ? -15 : 15;
      const x2 = side === "left" ? -10.5 : 10.5;

      addLine([
        new THREE.Vector3(x1, 0.04, -5.5),
        new THREE.Vector3(x2, 0.04, -5.5),
        new THREE.Vector3(x2, 0.04, 5.5),
        new THREE.Vector3(x1, 0.04, 5.5),
      ]);
    }

    createPenaltyArea("left");
    createPenaltyArea("right");

    // Six-yard boxes
    function createGoalBox(side) {
      const x1 = side === "left" ? -15 : 15;
      const x2 = side === "left" ? -13 : 13;

      addLine([
        new THREE.Vector3(x1, 0.04, -2.5),
        new THREE.Vector3(x2, 0.04, -2.5),
        new THREE.Vector3(x2, 0.04, 2.5),
        new THREE.Vector3(x1, 0.04, 2.5),
      ]);
    }

    createGoalBox("left");
    createGoalBox("right");

    // ----------------------------------------------------------
    // GOALS
    // ----------------------------------------------------------

    const goalMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
    });

    function createGoal(x) {
      const goal = new THREE.Group();

      const post1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 2.4, 10),
        goalMaterial
      );

      post1.position.set(x, 1.2, -3);

      const post2 = post1.clone();

      post2.position.set(x, 1.2, 3);

      const crossbar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 6, 10),
        goalMaterial
      );

      crossbar.rotation.x = Math.PI / 2;
      crossbar.position.set(x, 2.4, 0);

      goal.add(post1);
      goal.add(post2);
      goal.add(crossbar);

      scene.add(goal);
    }

    createGoal(-15);
    createGoal(15);

    // ----------------------------------------------------------
    // BALL
    // ----------------------------------------------------------

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 20, 20),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.35,
      })
    );

    ball.position.set(0, 0.18, 0);

    ball.castShadow = true;

    scene.add(ball);

    ballRef.current = ball;

    // ----------------------------------------------------------
    // ANIMATION
    // ----------------------------------------------------------

    let lastTime = performance.now();

    function animate(now) {
      animationFrameRef.current =
        requestAnimationFrame(animate);

      const delta =
        Math.min(now - lastTime, 50) / 1000;

      lastTime = now;

      controls.update();

      // --------------------------------------------------------
      // PLAYERS
      // --------------------------------------------------------

      const allTeams = [
        homePlayersRef.current,
        awayPlayersRef.current,
      ];

      allTeams.forEach(playerMap => {
        playerMap.forEach(playerMesh => {
          const id = playerMesh.userData.playerId;
          const team = playerMesh.userData.team;

          const target =
            targetPlayersRef.current[team]?.get(id);

          if (!target) return;

          const dx =
            target.x - playerMesh.position.x;

          const dz =
            target.z - playerMesh.position.z;

          const distance =
            Math.sqrt(dx * dx + dz * dz);

          if (distance > 0.02) {
            const speed =
              target.speed || 3.5;

            const step =
              speed * delta;

            const ratio =
              Math.min(step / distance, 1);

            playerMesh.position.x += dx * ratio;
            playerMesh.position.z += dz * ratio;

            playerMesh.rotation.y =
              Math.atan2(dx, dz);

            // Small running animation
            const running =
              Math.min(distance / 2, 1);

            playerMesh.position.y =
              Math.sin(now * 0.015) *
              0.035 *
              running;
          }
        });
      });

      // --------------------------------------------------------
      // BALL
      // --------------------------------------------------------

      const ballState =
        ballStateRef.current;

      if (ballState && ballRef.current) {
        const ballMesh = ballRef.current;

        if (
          ballState.mode === "owner"
        ) {
          const ownerMap =
            ballState.team === "home"
              ? homePlayersRef.current
              : awayPlayersRef.current;

          const owner =
            ownerMap.get(ballState.ownerId);

          if (owner) {
            ballMesh.position.x =
              owner.position.x;

            ballMesh.position.z =
              owner.position.z;

            ballMesh.position.y =
              0.22 +
              Math.abs(
                Math.sin(now * 0.01)
              ) * 0.04;
          }
        }

        if (
          ballState.mode === "pass" ||
          ballState.mode === "shot"
        ) {
          const elapsed =
            now - ballState.startedAt;

          const duration =
            ballState.duration || 600;

          const t =
            Math.min(
              elapsed / duration,
              1
            );

          // Smooth interpolation
          const eased =
            t * t * (3 - 2 * t);

          const x =
            ballState.from.x +
            (ballState.to.x -
              ballState.from.x) *
              eased;

          const z =
            ballState.from.z +
            (ballState.to.z -
              ballState.from.z) *
              eased;

          ballMesh.position.x = x;
          ballMesh.position.z = z;

          // Ball rises during pass/shot
          const height =
            ballState.mode === "shot"
              ? Math.sin(t * Math.PI) * 1.2
              : Math.sin(t * Math.PI) * 0.35;

          ballMesh.position.y =
            0.18 + height;

          ballMesh.rotation.x +=
            delta * 8;

          ballMesh.rotation.z +=
            delta * 6;
        }
      }

      renderer.render(
        scene,
        camera
      );
    }

    animate(performance.now());

    // ----------------------------------------------------------
    // RESIZE
    // ----------------------------------------------------------

    function handleResize() {
      if (!mountRef.current) return;

      const w =
        mountRef.current.clientWidth ||
        900;

      const h =
        mountRef.current.clientHeight ||
        520;

      camera.aspect = w / h;

      camera.updateProjectionMatrix();

      renderer.setSize(w, h);

      renderer.setPixelRatio(
        Math.min(
          window.devicePixelRatio || 1,
          2
        )
      );
    }

    window.addEventListener(
      "resize",
      handleResize
    );

    // ----------------------------------------------------------
    // CLEANUP
    // ----------------------------------------------------------

    return () => {
      window.removeEventListener(
        "resize",
        handleResize
      );

      if (animationFrameRef.current) {
        cancelAnimationFrame(
          animationFrameRef.current
        );
      }

      controls.dispose();

      renderer.dispose();

      if (
        mount.contains(
          renderer.domElement
        )
      ) {
        mount.removeChild(
          renderer.domElement
        );
      }

      scene.traverse(object => {
        if (object.geometry) {
          object.geometry.dispose();
        }

        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(
              material => material.dispose()
            );
          } else {
            object.material.dispose();
          }
        }
      });

      scene.clear();

      sceneRef.current = null;
    };
  }, []);

  // ============================================================
  // CREATE / UPDATE PLAYERS
  // ============================================================

  useEffect(() => {
    const scene = sceneRef.current;

    if (!scene) return;

    const positions =
      getFormationPositions(formation);

    // ----------------------------------------------------------
    // REMOVE OLD PLAYERS
    // ----------------------------------------------------------

    homePlayersRef.current.forEach(mesh => {
      scene.remove(mesh);
    });

    awayPlayersRef.current.forEach(mesh => {
      scene.remove(mesh);
    });

    homePlayersRef.current.clear();
    awayPlayersRef.current.clear();

    targetPlayersRef.current.home.clear();
    targetPlayersRef.current.away.clear();

    // ----------------------------------------------------------
    // HOME
    // ----------------------------------------------------------

    homeXI.slice(0, 11).forEach(
      (player, index) => {
        const [x, z] =
          positions[index] || [-5, 0];

        const mesh = createPlayer(
          player,
          homeColor,
          "home",
          index
        );

        mesh.position.set(
          x,
          0,
          z
        );

        scene.add(mesh);

        const id =
          getPlayerId(
            player,
            index
          );

        homePlayersRef.current.set(
          id,
          mesh
        );

        targetPlayersRef.current.home.set(
          id,
          {
            x,
            z,
            speed: 3.5,
          }
        );
      }
    );

    // ----------------------------------------------------------
    // AWAY
    // ----------------------------------------------------------

    awayXI.slice(0, 11).forEach(
      (player, index) => {
        const [homeX, homeZ] =
          positions[index] || [-5, 0];

        const x = -homeX;
        const z = -homeZ;

        const mesh = createPlayer(
          player,
          awayColor,
          "away",
          index
        );

        mesh.position.set(
          x,
          0,
          z
        );

        scene.add(mesh);

        const id =
          getPlayerId(
            player,
            index
          );

        awayPlayersRef.current.set(
          id,
          mesh
        );

        targetPlayersRef.current.away.set(
          id,
          {
            x,
            z,
            speed: 3.5,
          }
        );
      }
    );
  }, [
    homeXI,
    awayXI,
    homeColor,
    awayColor,
    formation,
  ]);

  // ============================================================
  // RECEIVE SIMULATION
  // ============================================================

  useEffect(() => {
    if (!simulation) return;

    // Player targets
    if (simulation.players) {
      ["home", "away"].forEach(team => {
        const teamPlayers =
          simulation.players[team] || [];

        teamPlayers.forEach(player => {
          if (!player.id) return;

          targetPlayersRef.current[
            team
          ].set(
            player.id,
            {
              x: player.x,
              z: player.z,
              speed:
                player.speed || 3.5,
            }
          );
        });
      });
    }

    // Ball
    if (simulation.ball) {
      ballStateRef.current =
        simulation.ball;
    }
  }, [simulation]);

  return (
    <div
      ref={mountRef}
      style={{
        width: "100%",
        height: "520px",
        minHeight: "420px",
        overflow: "hidden",
        borderRadius: "18px",
        background: "#07111f",
      }}
    />
  );
}
