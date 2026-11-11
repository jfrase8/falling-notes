import { Effect } from 'postprocessing'

const fragmentShader = /* glsl */ `
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float peak = max(inputColor.r, max(inputColor.g, inputColor.b));
    outputColor = vec4(inputColor.rgb / max(1.0, peak), inputColor.a);
  }
`

/**
 * Brings HDR colors back into display range by scaling instead of clipping per channel,
 * so bright gold stays gold (rather than washing out to yellow/white) after bloom.
 */
export class HueClipEffect extends Effect {
  constructor() {
    super('HueClipEffect', fragmentShader)
  }
}
