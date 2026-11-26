import * as THREE from 'three';
import './style.css';
import { App } from './ui/app';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch {
  ui.innerHTML = '<div class="screen"><p class="sub">Bu tarayıcı WebGL desteklemiyor. Güncel bir tarayıcıyla dene.</p></div>';
  throw new Error('WebGL unavailable');
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

new App(renderer, ui);

// Stop iOS double-tap zoom and pinch gestures from hijacking the game.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
