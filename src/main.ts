import { loadCatalog } from './catalog/load.ts';
import { createEditor, createPreview, type ViewState } from './controls.ts';
import { farmerParts } from './outfit.ts';
import { IDLE, WALK, WALK_FRAME_MS } from './render/animation.ts';
import { FRAME_HEIGHT, FRAME_WIDTH, FarmerRenderer } from './render/farmer.ts';
import { loadTextures } from './render/textures.ts';
import { createShareControls, outfitFromParams, syncUrl } from './share.ts';
import { createSummary } from './summary.ts';

const tutorial = document.querySelector<HTMLDialogElement>('#tutorial')!;
document.querySelector('#help')!.addEventListener('click', () => tutorial.showModal());
tutorial.addEventListener('click', (event) => {
  const box = tutorial.getBoundingClientRect();
  const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  if (outside) tutorial.close();
});
try {
  if (!localStorage.getItem('tutorial-seen')) {
    localStorage.setItem('tutorial-seen', '1');
    tutorial.showModal();
  }
} catch {}

const app = document.querySelector<HTMLDivElement>('#app')!;
const catalog = await loadCatalog();
const textures = await loadTextures(catalog);
const renderer = new FarmerRenderer(catalog, textures);

const state: ViewState = {
  outfit: outfitFromParams(catalog, new URLSearchParams(location.search)),
  direction: 'down',
  walking: false,
};

const canvas = document.createElement('canvas');
canvas.width = FRAME_WIDTH;
canvas.height = FRAME_HEIGHT;
canvas.className = 'h-[288px] w-[160px] [image-rendering:pixelated]';
const context = canvas.getContext('2d')!;

const { tabs, panel, howTo, refresh } = createEditor(catalog, state, renderer, textures);
document.querySelector('#details')!.append(howTo);
const content = document.createElement('div');
content.className = 'flex flex-col items-center gap-8 md:flex-row md:items-start';
const preview = createPreview(canvas, state, catalog);
preview.append(createShareControls(catalog, state, renderer));
content.append(preview, panel);
app.replaceChildren(tabs, content);

const summary = createSummary(catalog, state, renderer);
document.querySelector('#summary')!.append(summary.panel);
const updateUrl = syncUrl(catalog, state);

let lastDrawn = '';

function draw(time: number): void {
  refresh();
  summary.refresh();
  updateUrl();
  const frames = WALK[state.direction];
  const step = state.walking ? Math.floor(time / WALK_FRAME_MS) % frames.length : -1;
  const parts = farmerParts(state.outfit);
  const animated = renderer.isAnimated(parts);
  const key = JSON.stringify([state, step, animated ? time : 0]);
  if (key !== lastDrawn) {
    lastDrawn = key;
    const surface = renderer.render(parts, state.direction, step < 0 ? IDLE[state.direction] : frames[step], time);
    context.putImageData(new ImageData(surface.toStraightAlpha(), FRAME_WIDTH, FRAME_HEIGHT), 0, 0);
  }
  requestAnimationFrame(draw);
}

requestAnimationFrame(draw);
