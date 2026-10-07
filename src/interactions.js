import { Object3D, Quaternion, Vector3 } from 'three';
import { VRMLookAtBoneApplier, VRMLookAtExpressionApplier } from '@pixiv/three-vrm';

export function createInteractions(vrm) {
  const expressions = vrm.expressionManager;
  const supports = (name) => Boolean(expressions?.getExpression(name)?.binds.length);
  const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
  const basePose = spine?.quaternion.clone();
  const capabilities = {
    happy: supports('happy'),
    surprised: supports('surprised'),
    blink: supports('blink'),
    idle: Boolean(spine),
    gaze: vrm.lookAt?.applier instanceof VRMLookAtExpressionApplier
      ? ['lookUp', 'lookDown', 'lookLeft', 'lookRight'].some(supports)
      : vrm.lookAt?.applier instanceof VRMLookAtBoneApplier
        && ['leftEye', 'rightEye'].some((name) => vrm.humanoid.getRawBoneNode(name)),
  };
  let reaction = null;
  let remaining = 0;
  let elapsed = 0;
  const sway = new Quaternion();
  const axis = new Vector3(0, 0, 1);
  const lookTarget = new Object3D();

  return {
    capabilities,
    react(name) {
      if (!['happy', 'surprised'].includes(name) || !capabilities[name]) return;
      reaction = name;
      remaining = 1.5;
    },
    reset() {
      reaction = null;
      remaining = 0;
      elapsed = 0;
      expressions?.setValue('blink', 0);
      if (spine) spine.quaternion.copy(basePose);
      if (vrm.lookAt) {
        vrm.lookAt.target = undefined;
        vrm.lookAt.reset();
      }
    },
    update(delta, { motionEnabled, gazeTarget }) {
      if (capabilities.gaze) {
        if (gazeTarget) {
          if (!vrm.lookAt.target) lookTarget.position.copy(gazeTarget);
          else lookTarget.position.lerp(gazeTarget, 1 - Math.exp(-8 * delta));
          vrm.lookAt.target = lookTarget;
        } else if (vrm.lookAt.target) {
          vrm.lookAt.target = undefined;
          vrm.lookAt.reset();
        }
      }
      elapsed = motionEnabled ? elapsed + delta : 0;
      if (motionEnabled && reaction) {
        remaining = Math.max(0, remaining - delta);
        if (remaining === 0) reaction = null;
      }
      const blinkPhase = elapsed % 4;
      const blink = elapsed < 4 ? 0 : blinkPhase < 0.08
        ? blinkPhase / 0.08 : Math.max(0, 1 - (blinkPhase - 0.08) / 0.12);
      if (capabilities.blink) expressions.setValue('blink', blink);
      if (spine) {
        const angle = Math.PI / 240 * Math.sin(elapsed * Math.PI * 2 / 5);
        spine.quaternion.copy(basePose).multiply(sway.setFromAxisAngle(axis, angle));
      }
      expressions?.setValue('happy', reaction === 'happy' ? 1 : 0);
      expressions?.setValue('surprised', reaction === 'surprised' ? 1 : 0);
    },
  };
}
