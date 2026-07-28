import { VRMHumanBoneName } from '@pixiv/three-vrm'

type BoneMapEntry = {
  fbxNames: string[]
  vrm: string
}

const BONE_MAP: BoneMapEntry[] = [
  { fbxNames: ['Hips', 'mixamorig:Hips', 'HIP', 'hips', 'Pelvis'], vrm: VRMHumanBoneName.Hips },
  { fbxNames: ['Spine', 'mixamorig:Spine', 'SPI', 'spine'], vrm: VRMHumanBoneName.Spine },
  { fbxNames: ['Spine1', 'mixamorig:Spine1', 'Spine01', 'chest', 'Chest'], vrm: VRMHumanBoneName.Chest },
  { fbxNames: ['Spine2', 'mixamorig:Spine2', 'Spine02', 'UpperChest', 'upperChest'], vrm: VRMHumanBoneName.UpperChest },
  { fbxNames: ['Neck', 'mixamorig:Neck', 'NECK', 'neck'], vrm: VRMHumanBoneName.Neck },
  { fbxNames: ['Head', 'mixamorig:Head', 'HEAD', 'head'], vrm: VRMHumanBoneName.Head },
  { fbxNames: ['LeftShoulder', 'mixamorig:LeftShoulder', 'L_Shoulder', 'leftShoulder'], vrm: VRMHumanBoneName.LeftShoulder },
  { fbxNames: ['LeftArm', 'mixamorig:LeftArm', 'L_UpperArm', 'leftUpperArm', 'LeftUpperArm'], vrm: VRMHumanBoneName.LeftUpperArm },
  { fbxNames: ['LeftForeArm', 'mixamorig:LeftForeArm', 'L_LowerArm', 'leftLowerArm', 'LeftLowerArm'], vrm: VRMHumanBoneName.LeftLowerArm },
  { fbxNames: ['LeftHand', 'mixamorig:LeftHand', 'L_Hand', 'leftHand'], vrm: VRMHumanBoneName.LeftHand },
  { fbxNames: ['RightShoulder', 'mixamorig:RightShoulder', 'R_Shoulder', 'rightShoulder'], vrm: VRMHumanBoneName.RightShoulder },
  { fbxNames: ['RightArm', 'mixamorig:RightArm', 'R_UpperArm', 'rightUpperArm', 'RightUpperArm'], vrm: VRMHumanBoneName.RightUpperArm },
  { fbxNames: ['RightForeArm', 'mixamorig:RightForeArm', 'R_LowerArm', 'rightLowerArm', 'RightLowerArm'], vrm: VRMHumanBoneName.RightLowerArm },
  { fbxNames: ['RightHand', 'mixamorig:RightHand', 'R_Hand', 'rightHand'], vrm: VRMHumanBoneName.RightHand },
  { fbxNames: ['LeftUpLeg', 'mixamorig:LeftUpLeg', 'L_UpperLeg', 'leftUpperLeg', 'LeftUpperLeg'], vrm: VRMHumanBoneName.LeftUpperLeg },
  { fbxNames: ['LeftLeg', 'mixamorig:LeftLeg', 'L_LowerLeg', 'leftLowerLeg', 'LeftLowerLeg'], vrm: VRMHumanBoneName.LeftLowerLeg },
  { fbxNames: ['LeftFoot', 'mixamorig:LeftFoot', 'L_Foot', 'leftFoot'], vrm: VRMHumanBoneName.LeftFoot },
  { fbxNames: ['LeftToeBase', 'mixamorig:LeftToeBase', 'L_Toes', 'leftToes', 'LeftToes'], vrm: VRMHumanBoneName.LeftToes },
  { fbxNames: ['RightUpLeg', 'mixamorig:RightUpLeg', 'R_UpperLeg', 'rightUpperLeg', 'RightUpperLeg'], vrm: VRMHumanBoneName.RightUpperLeg },
  { fbxNames: ['RightLeg', 'mixamorig:RightLeg', 'R_LowerLeg', 'rightLowerLeg', 'RightLowerLeg'], vrm: VRMHumanBoneName.RightLowerLeg },
  { fbxNames: ['RightFoot', 'mixamorig:RightFoot', 'R_Foot', 'rightFoot'], vrm: VRMHumanBoneName.RightFoot },
  { fbxNames: ['RightToeBase', 'mixamorig:RightToeBase', 'R_Toes', 'rightToes', 'RightToes'], vrm: VRMHumanBoneName.RightToes },
  { fbxNames: ['LeftEye', 'mixamorig:LeftEye', 'L_Eye', 'leftEye'], vrm: VRMHumanBoneName.LeftEye },
  { fbxNames: ['RightEye', 'mixamorig:RightEye', 'R_Eye', 'rightEye'], vrm: VRMHumanBoneName.RightEye },
  { fbxNames: ['LeftThumbProximal', 'Left Thumb', 'leftThumbProximal'], vrm: VRMHumanBoneName.LeftThumbProximal },
  { fbxNames: ['LeftThumbIntermediate', 'leftThumbIntermediate'], vrm: VRMHumanBoneName.LeftThumbMetacarpal },
  { fbxNames: ['LeftThumbDistal', 'leftThumbDistal'], vrm: VRMHumanBoneName.LeftThumbDistal },
  { fbxNames: ['LeftIndexProximal', 'leftIndexProximal'], vrm: VRMHumanBoneName.LeftIndexProximal },
  { fbxNames: ['LeftIndexIntermediate', 'leftIndexIntermediate'], vrm: VRMHumanBoneName.LeftIndexIntermediate },
  { fbxNames: ['LeftIndexDistal', 'leftIndexDistal'], vrm: VRMHumanBoneName.LeftIndexDistal },
  { fbxNames: ['LeftMiddleProximal', 'leftMiddleProximal'], vrm: VRMHumanBoneName.LeftMiddleProximal },
  { fbxNames: ['LeftMiddleIntermediate', 'leftMiddleIntermediate'], vrm: VRMHumanBoneName.LeftMiddleIntermediate },
  { fbxNames: ['LeftMiddleDistal', 'leftMiddleDistal'], vrm: VRMHumanBoneName.LeftMiddleDistal },
  { fbxNames: ['LeftRingProximal', 'leftRingProximal'], vrm: VRMHumanBoneName.LeftRingProximal },
  { fbxNames: ['LeftRingIntermediate', 'leftRingIntermediate'], vrm: VRMHumanBoneName.LeftRingIntermediate },
  { fbxNames: ['LeftRingDistal', 'leftRingDistal'], vrm: VRMHumanBoneName.LeftRingDistal },
  { fbxNames: ['LeftLittleProximal', 'leftLittleProximal'], vrm: VRMHumanBoneName.LeftLittleProximal },
  { fbxNames: ['LeftLittleIntermediate', 'leftLittleIntermediate'], vrm: VRMHumanBoneName.LeftLittleIntermediate },
  { fbxNames: ['LeftLittleDistal', 'leftLittleDistal'], vrm: VRMHumanBoneName.LeftLittleDistal },
  { fbxNames: ['RightThumbProximal', 'Right Thumb', 'rightThumbProximal'], vrm: VRMHumanBoneName.RightThumbProximal },
  { fbxNames: ['RightThumbIntermediate', 'rightThumbIntermediate'], vrm: VRMHumanBoneName.RightThumbMetacarpal },
  { fbxNames: ['RightThumbDistal', 'rightThumbDistal'], vrm: VRMHumanBoneName.RightThumbDistal },
  { fbxNames: ['RightIndexProximal', 'rightIndexProximal'], vrm: VRMHumanBoneName.RightIndexProximal },
  { fbxNames: ['RightIndexIntermediate', 'rightIndexIntermediate'], vrm: VRMHumanBoneName.RightIndexIntermediate },
  { fbxNames: ['RightIndexDistal', 'rightIndexDistal'], vrm: VRMHumanBoneName.RightIndexDistal },
  { fbxNames: ['RightMiddleProximal', 'rightMiddleProximal'], vrm: VRMHumanBoneName.RightMiddleProximal },
  { fbxNames: ['RightMiddleIntermediate', 'rightMiddleIntermediate'], vrm: VRMHumanBoneName.RightMiddleIntermediate },
  { fbxNames: ['RightMiddleDistal', 'rightMiddleDistal'], vrm: VRMHumanBoneName.RightMiddleDistal },
  { fbxNames: ['RightRingProximal', 'rightRingProximal'], vrm: VRMHumanBoneName.RightRingProximal },
  { fbxNames: ['RightRingIntermediate', 'rightRingIntermediate'], vrm: VRMHumanBoneName.RightRingIntermediate },
  { fbxNames: ['RightRingDistal', 'rightRingDistal'], vrm: VRMHumanBoneName.RightRingDistal },
  { fbxNames: ['RightLittleProximal', 'rightLittleProximal'], vrm: VRMHumanBoneName.RightLittleProximal },
  { fbxNames: ['RightLittleIntermediate', 'rightLittleIntermediate'], vrm: VRMHumanBoneName.RightLittleIntermediate },
  { fbxNames: ['RightLittleDistal', 'rightLittleDistal'], vrm: VRMHumanBoneName.RightLittleDistal },
]

const fbxToHumanoid = new Map<string, string>()
const humanoidToFbx = new Map<string, string[]>()

for (const entry of BONE_MAP) {
  for (const fbxName of entry.fbxNames) {
    fbxToHumanoid.set(fbxName.toLowerCase(), entry.vrm)
  }
  humanoidToFbx.set(entry.vrm, entry.fbxNames)
}

export { fbxToHumanoid, humanoidToFbx }

export function findHumanoidBone(fbxBoneName: string): string | null {
  const key = fbxBoneName.toLowerCase()
  if (fbxToHumanoid.has(key)) return fbxToHumanoid.get(key)!
  const withoutPrefix = key.replace(/^[^:]+:/, '')
  if (fbxToHumanoid.has(withoutPrefix)) return fbxToHumanoid.get(withoutPrefix)!
  return null
}

export function buildBoneRemap(
  actualVrmBones: Map<string, string>,
): Map<string, string> {
  const remap = new Map<string, string>()
  for (const [fbxBoneName, humanoidName] of fbxToHumanoid) {
    const actual = actualVrmBones.get(humanoidName)
    if (actual) {
      remap.set(fbxBoneName, actual)
    }
  }
  return remap
}
