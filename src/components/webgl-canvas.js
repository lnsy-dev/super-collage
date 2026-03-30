const PARTICLE_COUNT = 8000;
const STRIDE = 5; // x, y, vx, vy, hue per particle

const VERT_SRC = `#version 300 es
precision highp float;

in float a_x;
in float a_y;
in float a_hue;

uniform float u_time;
uniform vec2 u_resolution;

out vec3 v_color;

vec3 hsl2rgb(float h, float s, float l) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
  float m = l - c * 0.5;
  if (h < 1.0/6.0)      return vec3(c+m, x+m, m);
  else if (h < 2.0/6.0) return vec3(x+m, c+m, m);
  else if (h < 3.0/6.0) return vec3(m, c+m, x+m);
  else if (h < 4.0/6.0) return vec3(m, x+m, c+m);
  else if (h < 5.0/6.0) return vec3(x+m, m, c+m);
  else                   return vec3(c+m, m, x+m);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 pos = vec2(a_x / aspect, a_y);

  gl_Position = vec4(pos, 0.0, 1.0);
  gl_PointSize = 2.0 + sin(u_time * 0.5 + a_hue * 6.28) * 0.5;

  float lightness = 0.5 + 0.2 * sin(u_time * 0.4 + a_hue * 3.14);
  v_color = hsl2rgb(a_hue, 0.8, lightness);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec3 v_color;
out vec4 fragColor;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float alpha = 1.0 - smoothstep(0.4, 1.0, d);
  fragColor = vec4(v_color, alpha * 0.85);
}
`;

class WebGLCanvas extends HTMLElement {
  #canvas = null;
  #gl = null;
  #program = null;
  #buf = null;
  #renderBuf = null;
  #simData = null;
  #wasm = null;
  #raf = null;
  #startTime = performance.now();

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; height: 100%; }
        canvas { display: block; width: 100%; height: 100%; }
      </style>
      <canvas></canvas>
    `;
  }

  async connectedCallback() {
    this.#canvas = this.shadowRoot.querySelector('canvas');
    this.#initGL();
    this.#initResizeObserver();

    try {
      await this.#loadWasm();
      this.dispatchEvent(new CustomEvent('wasm-ready', { bubbles: true, composed: true }));
    } catch (err) {
      console.error('WASM load failed:', err);
      this.dispatchEvent(new CustomEvent('wasm-error', {
        detail: err.message,
        bubbles: true,
        composed: true,
      }));
    }

    this.#loop();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.#raf);
  }

  #initGL() {
    const gl = this.#canvas.getContext('webgl2', {
      antialias: false,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.#gl = gl;

    const vs = this.#compileShader(gl.VERTEX_SHADER, VERT_SRC);
    const fs = this.#compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog));
    }
    this.#program = prog;

    this.#buf = gl.createBuffer();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  }

  #compileShader(type, src) {
    const gl = this.#gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s));
    }
    return s;
  }

  async #loadWasm() {
    const mod = await import('/src/wasm/super_collage.js');
    await mod.default();
    this.#wasm = mod;

    this.#simData = mod.init_particles(PARTICLE_COUNT, Date.now() & 0xffffffff);
  }

  #initResizeObserver() {
    const ro = new ResizeObserver(() => this.#resize());
    ro.observe(this.#canvas);
    this.#resize();
  }

  #resize() {
    const dpr = devicePixelRatio || 1;
    const w = Math.round(this.#canvas.clientWidth * dpr);
    const h = Math.round(this.#canvas.clientHeight * dpr);
    if (this.#canvas.width !== w || this.#canvas.height !== h) {
      this.#canvas.width = w;
      this.#canvas.height = h;
    }
  }

  #loop() {
    const gl = this.#gl;
    const prog = this.#program;

    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes  = gl.getUniformLocation(prog, 'u_resolution');
    const aX    = gl.getAttribLocation(prog, 'a_x');
    const aY    = gl.getAttribLocation(prog, 'a_y');
    const aHue  = gl.getAttribLocation(prog, 'a_hue');

    let lastTime = performance.now();

    const frame = () => {
      this.#raf = requestAnimationFrame(frame);

      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      const t  = (now - this.#startTime) / 1000;
      lastTime = now;

      // Step simulation via WASM (if loaded)
      if (this.#wasm && this.#simData) {
        this.#wasm.step_particles(this.#simData, dt, t);
        this.#renderBuf = this.#wasm.extract_render_data(this.#simData);
      }

      const w = this.#canvas.width;
      const h = this.#canvas.height;
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.04, 0.04, 0.06, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (!this.#renderBuf) return;

      gl.useProgram(prog);
      gl.uniform1f(uTime, t);
      gl.uniform2f(uRes, w, h);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.#buf);
      gl.bufferData(gl.ARRAY_BUFFER, this.#renderBuf, gl.DYNAMIC_DRAW);

      // Layout: [x, y, hue] per particle — stride 3 floats = 12 bytes
      const bytes = Float32Array.BYTES_PER_ELEMENT;
      gl.enableVertexAttribArray(aX);
      gl.vertexAttribPointer(aX, 1, gl.FLOAT, false, bytes * 3, 0);
      gl.enableVertexAttribArray(aY);
      gl.vertexAttribPointer(aY, 1, gl.FLOAT, false, bytes * 3, bytes);
      gl.enableVertexAttribArray(aHue);
      gl.vertexAttribPointer(aHue, 1, gl.FLOAT, false, bytes * 3, bytes * 2);

      gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
    };

    frame();
  }
}

customElements.define('webgl-canvas', WebGLCanvas);
