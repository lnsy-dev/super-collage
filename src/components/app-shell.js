const PAGE_SIZES = {
  'letter':      { label: 'Letter',      dims: '8.5 × 11 in',   w: 8.5,  h: 11   },
  'legal':       { label: 'Legal',       dims: '8.5 × 14 in',   w: 8.5,  h: 14   },
  'half-letter': { label: 'Half Letter', dims: '5.5 × 8.5 in',  w: 5.5,  h: 8.5  },
  '4x6':         { label: '4 × 6',       dims: '4 × 6 in',      w: 4,    h: 6    },
  '4.25x7':      { label: '4.25 × 7',    dims: '4.25 × 7 in',   w: 4.25, h: 7    },
};

const template = document.createElement('template');
template.innerHTML = `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=DM+Serif+Display:ital@0;1&display=swap');

    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      background: #0a0a0f;
      overflow: hidden;
      font-family: 'DM Mono', monospace;
      color: #e0d8f0;
    }

    /* ── CREATE VIEW ───────────────────────────────────────── */

    .create-view {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0;
      transition: opacity 0.4s ease, transform 0.4s ease;
    }

    .create-view.exit {
      opacity: 0;
      transform: translateY(-16px);
      pointer-events: none;
    }

    .create-view::before {
      content: '';
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse 60% 50% at 50% 40%, rgba(90,60,140,0.12) 0%, transparent 70%),
        repeating-linear-gradient(
          0deg,
          transparent,
          transparent 39px,
          rgba(255,255,255,0.025) 40px
        ),
        repeating-linear-gradient(
          90deg,
          transparent,
          transparent 39px,
          rgba(255,255,255,0.015) 40px
        );
      pointer-events: none;
    }

    .wordmark {
      font-family: 'DM Serif Display', serif;
      font-size: clamp(2rem, 5vw, 3.5rem);
      font-style: italic;
      letter-spacing: -0.02em;
      color: #e0d8f0;
      margin-bottom: 0.25rem;
      position: relative;
    }

    .tagline {
      font-size: 0.65rem;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: #5a526a;
      margin-bottom: 3.5rem;
      position: relative;
    }

    .form-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 2rem;
      padding: 2.5rem;
      width: min(480px, calc(100vw - 3rem));
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 2px;
      background: rgba(255,255,255,0.025);
      backdrop-filter: blur(8px);
    }

    .field-label {
      font-size: 0.65rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #5a526a;
      margin-bottom: 0.75rem;
    }

    .name-input {
      width: 100%;
      box-sizing: border-box;
      background: transparent;
      border: none;
      border-bottom: 1px solid rgba(255,255,255,0.12);
      padding: 0.5rem 0;
      font-family: 'DM Mono', monospace;
      font-size: 1rem;
      font-weight: 300;
      color: #e0d8f0;
      outline: none;
      transition: border-color 0.2s;
    }

    .name-input::placeholder {
      color: #3a3248;
    }

    .name-input:focus {
      border-bottom-color: rgba(160,130,255,0.5);
    }

    /* ── PAPER SIZE CARDS ──────────────────────────────────── */

    .size-options {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
      gap: 0.75rem;
    }

    .size-card {
      position: relative;
      cursor: pointer;
    }

    .size-card input[type="radio"] {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }

    .size-card-inner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.85rem;
      padding: 1.1rem 0.75rem 0.9rem;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 2px;
      background: rgba(255,255,255,0.02);
      transition: border-color 0.2s, background 0.2s;
      user-select: none;
    }

    .size-card:hover .size-card-inner {
      border-color: rgba(255,255,255,0.18);
      background: rgba(255,255,255,0.04);
    }

    .size-card input:checked ~ .size-card-inner {
      border-color: rgba(160,130,255,0.55);
      background: rgba(120,90,200,0.1);
    }

    /* little paper icon at correct aspect ratio */
    .paper-icon {
      width: 28px;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 1px;
      flex-shrink: 0;
      position: relative;
    }

    .paper-icon::after {
      content: '';
      position: absolute;
      top: 3px;
      right: 3px;
      width: 0;
      height: 0;
      border-left: 4px solid transparent;
      border-bottom: 4px solid rgba(255,255,255,0.2);
    }

    .size-card input:checked ~ .size-card-inner .paper-icon {
      background: rgba(160,130,255,0.15);
      border-color: rgba(160,130,255,0.4);
    }

    .size-name {
      font-size: 0.7rem;
      letter-spacing: 0.08em;
      color: #9a92b0;
      text-align: center;
      transition: color 0.2s;
    }

    .size-dims {
      font-size: 0.6rem;
      letter-spacing: 0.06em;
      color: #5a526a;
      text-align: center;
      transition: color 0.2s;
    }

    .size-card input:checked ~ .size-card-inner .size-name {
      color: #c8bef0;
    }

    .size-card input:checked ~ .size-card-inner .size-dims {
      color: #9a88c8;
    }

    /* ── CREATE BUTTON ─────────────────────────────────────── */

    .create-btn {
      align-self: flex-end;
      background: transparent;
      border: 1px solid rgba(160,130,255,0.4);
      color: #c8bef0;
      font-family: 'DM Mono', monospace;
      font-size: 0.7rem;
      font-weight: 500;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      padding: 0.75rem 1.75rem;
      cursor: pointer;
      border-radius: 1px;
      transition: background 0.2s, border-color 0.2s, color 0.2s;
    }

    .create-btn:hover {
      background: rgba(160,130,255,0.12);
      border-color: rgba(160,130,255,0.7);
      color: #e0d8f0;
    }

    .create-btn:active {
      background: rgba(160,130,255,0.2);
    }

    /* ── CANVAS VIEW ───────────────────────────────────────── */

    .canvas-view {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      opacity: 0;
      transform: translateY(16px);
      pointer-events: none;
      transition: opacity 0.4s ease 0.1s, transform 0.4s ease 0.1s;
    }

    .canvas-view.visible {
      opacity: 1;
      transform: translateY(0);
      pointer-events: all;
    }

    .canvas-header {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 10;
      display: flex;
      align-items: baseline;
      gap: 1rem;
      padding: 1rem 1.5rem;
      background: linear-gradient(to bottom, rgba(10,10,15,0.9) 0%, transparent 100%);
    }

    .project-title {
      font-family: 'DM Serif Display', serif;
      font-style: italic;
      font-size: 1.05rem;
      color: #e0d8f0;
      opacity: 0.85;
    }

    .project-size-label {
      font-size: 0.65rem;
      letter-spacing: 0.12em;
      color: #5a526a;
    }

    .canvas-status {
      margin-left: auto;
      font-size: 0.65rem;
      letter-spacing: 0.1em;
      color: #5a526a;
    }

    webgl-canvas {
      flex: 1;
    }
  </style>

  <!-- CREATE VIEW -->
  <div class="create-view" id="create-view">
    <div class="wordmark">Super Collage</div>
    <div class="tagline">Digital cut &amp; paste studio</div>

    <div class="form-card">
      <div>
        <div class="field-label">Project name</div>
        <input class="name-input" id="project-name" type="text" placeholder="Untitled collage" autocomplete="off" spellcheck="false" />
      </div>

      <div>
        <div class="field-label">Paper size</div>
        <div class="size-options" id="size-options"></div>
      </div>

      <button class="create-btn" id="create-btn">Create project</button>
    </div>
  </div>

  <!-- CANVAS VIEW -->
  <div class="canvas-view" id="canvas-view">
    <div class="canvas-header">
      <span class="project-title" id="header-title"></span>
      <span class="project-size-label" id="header-size"></span>
      <span class="canvas-status" id="status">Loading…</span>
    </div>
    <webgl-canvas></webgl-canvas>
  </div>
`;

class AppShell extends HTMLElement {
  #selectedSize = 'letter';
  #projectName  = '';

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
  }

  connectedCallback() {
    this.#buildSizeOptions();
    this.#wireCreateForm();
    this.#wireCanvas();
  }

  #buildSizeOptions() {
    const container = this.shadowRoot.getElementById('size-options');

    for (const [key, info] of Object.entries(PAGE_SIZES)) {
      const label = document.createElement('label');
      label.className = 'size-card';

      const radio = document.createElement('input');
      radio.type  = 'radio';
      radio.name  = 'page-size';
      radio.value = key;
      if (key === this.#selectedSize) radio.checked = true;
      radio.addEventListener('change', () => { this.#selectedSize = key; });

      // paper icon height scaled to aspect ratio (capped)
      const { w, h } = info;
      const iconH = Math.round(28 * (h / w));

      label.innerHTML = `
        <div class="size-card-inner">
          <div class="paper-icon" style="height:${iconH}px"></div>
          <span class="size-name">${info.label}</span>
          <span class="size-dims">${info.dims}</span>
        </div>
      `;
      label.prepend(radio);
      container.appendChild(label);
    }
  }

  #wireCreateForm() {
    const btn   = this.shadowRoot.getElementById('create-btn');
    const input = this.shadowRoot.getElementById('project-name');

    const submit = () => {
      this.#projectName = input.value.trim() || 'Untitled collage';
      this.#transition();
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  #wireCanvas() {
    const canvas = this.shadowRoot.querySelector('webgl-canvas');
    const status = this.shadowRoot.getElementById('status');

    canvas.addEventListener('wasm-ready', () => { status.textContent = 'Running'; });
    canvas.addEventListener('wasm-error', (e) => { status.textContent = `Error: ${e.detail}`; });
  }

  #transition() {
    const size = PAGE_SIZES[this.#selectedSize];

    this.shadowRoot.getElementById('header-title').textContent = this.#projectName;
    this.shadowRoot.getElementById('header-size').textContent  = size.dims;

    this.shadowRoot.getElementById('create-view').classList.add('exit');
    this.shadowRoot.getElementById('canvas-view').classList.add('visible');
  }
}

customElements.define('app-shell', AppShell);
