/**
 * The lobby: the first interior the player sees, so it carries most of the
 * first-impression budget. Polished floor, warm cove lighting, a real reception
 * desk, and signage that tells you where you are.
 */
import { WorldText as Text } from '../ui/WorldText'
import { LOBBY, RECEPTION_DESK, SHAFT } from './layout'
import { PALETTE, type QualitySettings } from './palette'
import { useLobbyFloorMaterial, useLobbyWallMaterial } from './PBRMaterials'

const W = LOBBY.halfWidth
const BACK = LOBBY.backZ
const CEIL = LOBBY.ceiling
const DEPTH = Math.abs(BACK)

/**
 * A ceiling light run.
 *
 * Intensity is candela and falls off as 1/d². Over a 42 m x 30 m lobby with a
 * 9.5 m ceiling that means values in the high hundreds — the first pass used
 * 26 and the whole interior rendered essentially black. Two lamps per run,
 * offset on X, so the light does not collapse to a single hot spot down the
 * middle.
 */
function CoveLight({ z, shadows }: { z: number; shadows?: boolean }) {
  return (
    <>
      <mesh position={[0, CEIL - 0.3, z]}>
        <boxGeometry args={[W * 2 - 2, 0.07, 0.55]} />
        <meshBasicMaterial color={PALETTE.warmLight} toneMapped={false} />
      </mesh>
      {[-9, 9].map((x) => (
        <pointLight
          key={x}
          position={[x, CEIL - 1.1, z]}
          color={PALETTE.warmLight}
          intensity={115}
          distance={28}
          decay={2}
          castShadow={shadows}
          shadow-mapSize={[512, 512]}
          shadow-bias={-0.001}
          shadow-camera-near={0.5}
          shadow-camera-far={28}
        />
      ))}
    </>
  )
}

/**
 * Cool wash up the side walls.
 *
 * With warm practicals as the only source every surface converged on the same
 * cream and the room read flat. Warm key against cool fill is what gives an
 * interior depth — and it lets the teal accents belong to the same world
 * rather than looking stuck on.
 */
function WallWash({ z }: { z: number }) {
  return (
    <>
      {[-1, 1].map((s) => (
        <pointLight
          key={s}
          position={[s * (W - 1.6), 4.4, z]}
          color={PALETTE.coolLight}
          intensity={32}
          distance={24}
          decay={2}
        />
      ))}
    </>
  )
}

export function Lobby({ quality }: { quality: QualitySettings }) {
  const floorMat = useLobbyFloorMaterial(quality.reflections ? 0.36 : 0.48)
  const wallMat = useLobbyWallMaterial()

  return (
    <group>
      {/* Floor. Dark, near-mirror — the single biggest perceived-quality win
          in the whole scene, so it gets the reflective material at high. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, BACK / 2]} receiveShadow>
        <planeGeometry args={[W * 2, DEPTH]} />
        <primitive object={floorMat} attach="material" />
      </mesh>

      {/*
        Guide lines from door to lift.

        Two thin inlays, not a wide emissive strip. A 2.2 m glowing band run
        28 m into perspective and picked up by bloom read as a runway and
        washed the whole lobby green. Floor lighting should lead the eye, not
        become the subject.
      */}
      {[-1.35, 1.35].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.02, BACK / 2 + 1]}>
          <planeGeometry args={[0.1, DEPTH - 5]} />
          <meshBasicMaterial color={PALETTE.accent} toneMapped={false} />
        </mesh>
      ))}
      {/* Brushed inlay between them, dark — contrast, not glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, BACK / 2 + 1]}>
        <planeGeometry args={[2.7, DEPTH - 5]} />
        <meshStandardMaterial color="#141a22" roughness={0.5} metalness={0.55} />
      </mesh>

      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, CEIL, BACK / 2]}>
        <planeGeometry args={[W * 2, DEPTH]} />
        <meshStandardMaterial color={PALETTE.concreteDark} roughness={0.95} />
      </mesh>

      {/* Side walls */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * W, CEIL / 2, BACK / 2]} receiveShadow>
          <boxGeometry args={[0.5, CEIL, DEPTH]} />
          <primitive object={wallMat} attach="material" />
        </mesh>
      ))}

      {/* Back wall, split around the elevator opening */}
      {[-1, 1].map((s) => {
        const sideW = W - SHAFT.halfWidth
        return (
          <mesh
            key={s}
            position={[s * (SHAFT.halfWidth + sideW / 2), CEIL / 2, BACK]}
            receiveShadow
          >
            <boxGeometry args={[sideW, CEIL, 0.5]} />
            <meshStandardMaterial color={PALETTE.stone} roughness={0.7} metalness={0.2} />
          </mesh>
        )
      })}
      <mesh position={[0, CEIL - 1.5, BACK]}>
        <boxGeometry args={[SHAFT.halfWidth * 2, 6.5, 0.5]} />
        <meshStandardMaterial color={PALETTE.stone} roughness={0.7} metalness={0.2} />
      </mesh>

      {/* Columns */}
      {[-7, -15, -23].map((z) =>
        [-13.5, 13.5].map((x) => (
          <mesh key={`${x}:${z}`} position={[x, CEIL / 2, z]} castShadow={quality.shadows}>
            <boxGeometry args={[1.1, CEIL, 1.1]} />
            <meshStandardMaterial color={PALETTE.stone} roughness={0.6} metalness={0.3} />
          </mesh>
        )),
      )}

      <CoveLight z={-4} shadows={quality.shadows} />
      <CoveLight z={-11} />
      <CoveLight z={-18} />
      <CoveLight z={-25} />

      <WallWash z={-8} />
      <WallWash z={-20} />

      {/* Accent reveal where wall meets floor — reads as architecture, and
          gives the eye an edge to follow down a very deep room. */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (W - 0.3), 0.06, BACK / 2]}>
          <boxGeometry args={[0.06, 0.05, DEPTH - 2]} />
          <meshBasicMaterial color={PALETTE.accent} toneMapped={false} />
        </mesh>
      ))}

      {/* Reception desk */}
      <group position={[RECEPTION_DESK.x, 0, RECEPTION_DESK.z]}>
        <mesh position={[0, RECEPTION_DESK.h / 2, 0]} castShadow={quality.shadows} receiveShadow>
          <boxGeometry args={[RECEPTION_DESK.w, RECEPTION_DESK.h, RECEPTION_DESK.d]} />
          <meshStandardMaterial color="#1b1f26" roughness={0.35} metalness={0.5} />
        </mesh>
        {/* Lit reveal under the counter lip */}
        <mesh position={[0, RECEPTION_DESK.h - 0.14, RECEPTION_DESK.d / 2 + 0.01]}>
          <boxGeometry args={[RECEPTION_DESK.w - 0.3, 0.05, 0.04]} />
          <meshBasicMaterial color={PALETTE.accent} toneMapped={false} />
        </mesh>
        <mesh position={[0, RECEPTION_DESK.h + 0.02, 0]}>
          <boxGeometry args={[RECEPTION_DESK.w + 0.25, 0.06, RECEPTION_DESK.d + 0.25]} />
          <meshStandardMaterial color="#2b3038" roughness={0.25} metalness={0.7} />
        </mesh>
      </group>

      {/* Wall signage behind reception */}
      <Text
        position={[-6.5, 4.4, BACK + 0.3]}
        fontSize={0.85}
        color={PALETTE.accent}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0}
      >
        SHENRON
      </Text>
      <Text
        position={[-6.5, 3.55, BACK + 0.3]}
        fontSize={0.3}
        color="#7c8aa0"
        anchorX="center"
        anchorY="middle"
      >
        STANDALONE PROTOTYPE
      </Text>

      {/* Directory board */}
      <group position={[10, 2.6, BACK + 0.3]}>
        <mesh>
          <boxGeometry args={[6, 3.4, 0.08]} />
          <meshStandardMaterial color="#10141a" roughness={0.4} metalness={0.4} />
        </mesh>
        <Text position={[0, 1.32, 0.06]} fontSize={0.26} color={PALETTE.accent} anchorX="center">
          DIRECTORY
        </Text>
        {[
          ['45-50', 'AI HEADQUARTERS'],
          ['30-44', 'OPERATIONS'],
          ['12-29', 'ENGINEERING'],
          ['02-11', 'RESEARCH'],
          ['L', 'RECEPTION'],
        ].map(([floor, name], i) => (
          <group key={floor} position={[0, 0.78 - i * 0.46, 0.06]}>
            <Text position={[-2.4, 0, 0]} fontSize={0.22} color="#93a4bb" anchorX="left">
              {floor}
            </Text>
            <Text position={[-1.1, 0, 0]} fontSize={0.22} color="#63748c" anchorX="left">
              {name}
            </Text>
          </group>
        ))}
      </group>
    </group>
  )
}
