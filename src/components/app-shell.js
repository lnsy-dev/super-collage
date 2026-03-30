const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      display: flex;
      flex-direction: column;
      width: 100vw;
      height: 100vh;
      background: var(--bg, #0a0a0f);
    }

    header {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem 1.5rem;
      background: linear-gradient(to bottom, rgba(10,10,15,0.9) 0%, transparent 100%);
    }

    h1 {
      font-size: 1.1rem;
      font-weight: 500;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--text, #e0d8f0);
      opacity: 0.8;
    }

    .status {
      font-size: 0.75rem;
      color: var(--muted, #5a526a);
      letter-spacing: 0.08em;
    }

    .canvas-container {
      flex: 1;
      display: flex;
    }

    webgl-canvas {
      flex: 1;
    }
  </style>

  <header>
    <h1>Super Collage</h1>
    <span class="status" id="status">Loading WASM...</span>
  </header>

  <div class="canvas-container">
    <webgl-canvas></webgl-canvas>
  </div>
`;

class AppShell extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
  }

  connectedCallback() {
    const canvas = this.shadowRoot.querySelector('webgl-canvas');
    const status = this.shadowRoot.getElementById('status');

    canvas.addEventListener('wasm-ready', () => {
      status.textContent = 'Running';
    });

    canvas.addEventListener('wasm-error', (e) => {
      status.textContent = `WASM error: ${e.detail}`;
    });
  }
}

customElements.define('app-shell', AppShell);
