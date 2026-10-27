import { ACCESSORY_NAMES } from './accessory-names.ts';
import type { Catalog, Ingredient, Pants, Shirt, Source, Tailoring } from './catalog/types.ts';
import { BAR_MAX, barsToRgb, fromHex, hsvToRgb, rgbToBars, toHex, type Bars } from './color.ts';
import { createFilter, gameCheckbox } from './filters.ts';
import { randomOutfit } from './random.ts';
import { bootsColors, correctColors, hatColors, pantsColors, shirtColors } from './item-colors.ts';
import SOURCE_NOTES from './item-sources.json';
import { farmerParts, newFarmer, type Outfit } from './outfit.ts';
import type { Direction } from './render/animation.ts';
import { BODY_X, BODY_Y, type FarmerRenderer, type Parts } from './render/farmer.ts';
import { SCALE, type Pixels, type Rect, type Surface } from './render/pixels.ts';
import { VILLAGERS, villagerOutfit } from './villagers.ts';

export interface ViewState {
  outfit: Outfit;
  direction: Direction;
  walking: boolean;
}

interface Choice<T> {
  value: T;
  label?: string;
  caption?: string;
  details?: () => HTMLElement;
  picture: HTMLElement;
}

const LABEL = 'font-semibold';
const TAB =
  'flex h-12 w-12 items-center justify-center bg-[length:100%_100%] bg-no-repeat pt-2 [image-rendering:pixelated] transition-transform hover:-translate-y-0.5 aria-selected:translate-y-2';
const OPTION =
  'flex flex-col items-center rounded border-2 border-transparent bg-white/50 p-1 text-xs font-semibold hover:bg-white aria-pressed:border-[#8B4513] aria-pressed:bg-white';
const GENDER =
  'flex h-12 w-12 items-center justify-center rounded border-2 border-transparent bg-white/50 hover:bg-white aria-pressed:border-[#8B4513] aria-pressed:bg-white';
const UI_ICONS = {
  male: [13, 13],
  female: [10, 16],
  dice: [10, 10],
  'arrow-left': [44, 40],
  'arrow-right': [44, 40],
  down: [11, 12],
  letter: [15, 13],
};

const FULL_BODY = bodyArea(0, 0, 16, 32);
const BUST = bodyArea(0, 0, 16, 20);
const HEAD = bodyArea(0, 0, 16, 24);
export const TORSO = bodyArea(2, 13, 12, 12);
export const LEGS = bodyArea(0, 16, 16, 16);
export const FEET = bodyArea(0, 24, 16, 8);
export const WHOLE_HAT: Rect = { x: 0, y: 0, width: 20 * SCALE, height: 20 * SCALE };
const ICON_SCALE = 2;

const FACING: Direction[] = ['up', 'right', 'down', 'left'];
const OUTFIT_CHANGED = 'outfitchange';
export const BAR_NAMES = ['Hue', 'Saturation', 'Value'];
const previews = new WeakMap<HTMLElement, () => void>();

export function createPreview(canvas: HTMLCanvasElement, state: ViewState, catalog: Catalog): HTMLElement {
  const preview = document.createElement('div');
  preview.className = 'flex flex-col items-center gap-3';

  const frame = document.createElement('div');
  frame.className = 'relative rounded-lg border-4 border-[#8B4513] px-4 pt-4 pb-12';
  const rotate = (label: string, icon: 'arrow-left' | 'arrow-right', position: string, turn: number) => {
    const button = iconButton(label, icon, 1, `absolute bottom-1 ${position} transition-transform hover:scale-110`);
    button.addEventListener('click', () => {
      state.direction = FACING[(FACING.indexOf(state.direction) + turn) % FACING.length];
    });
    return button;
  };
  const random = iconButton('Random farmer', 'dice', 3, 'absolute top-2 left-2 transition-transform hover:scale-110');
  random.addEventListener('click', () => {
    Object.assign(state.outfit, randomOutfit(catalog, state.outfit));
    document.dispatchEvent(new Event(OUTFIT_CHANGED));
  });
  frame.append(
    canvas,
    random,
    rotate('Rotate left', 'arrow-left', 'left-1', 1),
    rotate('Rotate right', 'arrow-right', 'right-1', 3),
  );

  const genders = document.createElement('div');
  genders.className = 'flex gap-2';
  const genderButtons = (['Male', 'Female'] as const).map((label) => {
    const button = iconButton(label, label === 'Male' ? 'male' : 'female', 2, GENDER);
    button.addEventListener('click', () => {
      state.outfit.male = label === 'Male';
      syncGender();
    });
    return button;
  });
  const syncGender = () => {
    genderButtons.forEach((button, i) => (button.ariaPressed = String(state.outfit.male === (i === 0))));
  };
  syncGender();
  document.addEventListener(OUTFIT_CHANGED, syncGender);
  genders.append(...genderButtons);

  const walk = document.createElement('label');
  walk.className = 'flex cursor-pointer items-center gap-2 text-sm font-semibold';
  const walkBox = document.createElement('input');
  walkBox.type = 'checkbox';
  walkBox.checked = state.walking;
  walkBox.addEventListener('change', () => {
    state.walking = walkBox.checked;
  });
  walk.append(walkBox, gameCheckbox(walkBox, 27), 'Walk');

  preview.append(frame, genders, walk);
  return preview;
}

export function createEditor(
  catalog: Catalog,
  state: ViewState,
  renderer: FarmerRenderer,
  textures: Record<string, Pixels>,
): { tabs: HTMLElement; panel: HTMLElement; howTo: HTMLElement; refresh: () => void } {
  const { outfit } = state;
  const tabs = document.createElement('nav');
  tabs.role = 'tablist';
  tabs.className = 'flex items-end gap-3 border-b-2 border-[#8B4513] pb-1';
  const mainTabs = document.createElement('div');
  mainTabs.className = 'flex flex-1 flex-wrap justify-center gap-1';
  const divider = document.createElement('span');
  divider.ariaHidden = 'true';
  divider.className = 'mb-2 h-8 w-0.5 bg-[#8B4513]';
  const sideTabs = document.createElement('div');
  sideTabs.className = 'flex gap-1';
  const tabIcon = (parts: Parts | string, area: Rect, size: string) => {
    const canvas = thumbnail(size);
    paint(canvas, typeof parts === 'string' ? renderer.renderHat(parts) : renderer.render(parts), area);
    return canvas;
  };
  const farmer = farmerParts(newFarmer(catalog));
  const naked: Parts = { male: true, skin: farmer.skin, eyeColor: farmer.eyeColor };
  const tabIcons: Record<string, HTMLCanvasElement> = {
    Body: tabIcon(naked, bodyArea(0, 0, 16, 20), 'h-[30px] w-6'),
    Hair: tabIcon({ ...naked, hairstyle: farmer.hairstyle, hairColor: farmer.hairColor }, bodyArea(0, 0, 16, 16), 'h-6 w-6'),
    Shirt: tabIcon({ ...naked, shirt: farmer.shirt }, TORSO, 'h-6 w-6'),
    Pants: tabIcon({ ...naked, pants: farmer.pants, pantsColor: farmer.pantsColor }, LEGS, 'h-6 w-6'),
    Hat: tabIcon('0', WHOLE_HAT, 'h-[30px] w-[30px]'),
    Boots: tabIcon({ ...naked, boots: '506' }, FEET, 'h-3 w-6'),
  };
  tabs.append(mainTabs, divider, sideTabs);
  const panel = document.createElement('div');
  panel.className = 'min-w-80';
  const sections: { name: string; tab: HTMLButtonElement; section: HTMLElement; paint: () => void }[] = [];
  let active = 0;

  const howTo = document.createElement('div');
  howTo.className = 'flex flex-col gap-3 text-sm';
  const howToTitle = document.createElement('h2');
  howToTitle.className = 'text-lg font-bold';
  howToTitle.textContent = 'How to get';
  const howToHint = document.createElement('p');
  howToHint.className = 'text-black/60';
  howTo.append(howToTitle, howToHint);
  const wide = matchMedia('(min-width: 1500px)');
  let infos: { info: HTMLElement; home: HTMLElement; next: ChildNode | null; redraw?: () => void }[][] = [];
  const placeDetails = () => {
    infos.forEach((boxes, i) =>
      boxes.forEach(({ info, home, next }) => {
        if (wide.matches && i === active) howTo.append(info);
        else if (info.parentElement !== home) home.insertBefore(info, next);
      }),
    );
    const villagersTab = sections[active]?.name === 'Villagers';
    howToTitle.hidden = villagersTab;
    howToHint.textContent = villagersTab
      ? 'Pick your favourite Stardew Valley character to see your farmer dressed like them.'
      : 'Hover or pick a shirt, pants, hat or boots to see how to get it.';
    howToHint.hidden = infos[active]?.length > 0;
  };

  const show = (index: number) => {
    active = index;
    sections.forEach(({ tab, section }, i) => {
      tab.ariaSelected = String(i === index);
      section.hidden = i !== index;
    });
    placeDetails();
  };

  const section = (name: string, aside = false, frame = 'tab') => {
    const index = sections.length;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.role = 'tab';
    tab.ariaLabel = name;
    tab.title = name;
    tab.className = TAB;
    tab.style.backgroundImage = `url(${import.meta.env.BASE_URL}ui/${frame}.png)`;
    if (tabIcons[name]) tab.append(tabIcons[name]);
    tab.addEventListener('click', () => show(index));
    const grid = document.createElement('div');
    grid.role = 'tabpanel';
    grid.className = 'grid grid-cols-[6rem_auto] items-start gap-x-3 gap-y-3 text-sm';
    (aside ? sideTabs : mainTabs).append(tab);
    panel.append(grid);
    const entry = { name, tab, section: grid, paint: () => {} };
    sections.push(entry);
    return {
      row: (label: string, field: HTMLElement) => {
        const text = document.createElement('label');
        text.className = `${LABEL} pt-1`;
        text.textContent = label;
        grid.append(text, field);
      },
      paintWith: (paint: () => void) => {
        entry.paint = paint;
      },
    };
  };

  const bare = (): Parts => ({ male: outfit.male, skin: outfit.skin, eyeColor: barsToRgb(outfit.eyeColor) });
  const shirtNames = distinctNames(catalog.shirts);
  const pantsNames = distinctNames(catalog.pants);
  const hatNames = distinctNames(catalog.hats);
  const bootsNames = distinctNames(catalog.boots);
  const shirtLabels = itemLabels(catalog.shirts);
  const pantsLabels = itemLabels(catalog.pants);
  const hatLabels = itemLabels(catalog.hats);
  const bootsLabels = itemLabels(catalog.boots);
  const shirtNotes = notesFor('shirts', shirtNames);
  const pantsNotes = notesFor('pants', pantsNames);
  const hatNotes = notesFor('hats', hatNames);
  const bootsNotes = notesFor('boots', bootsNames);

  const body = section('Body');
  const skinPictures = Array.from({ length: catalog.skinTones.count }, () => thumbnail('h-16 w-8'));
  body.row(
    'Skin',
    choiceGrid(
      skinPictures.map((picture, skin) => ({ value: skin, label: String(skin + 1), picture })),
      'grid-cols-8',
      () => outfit.skin,
      (skin) => (outfit.skin = skin),
    ),
  );
  body.row(
    'Eyes',
    colorBars(
      () => outfit.eyeColor,
      (value) => {
        outfit.eyeColor = value;
      },
      'In game: new game or the Shrine of Illusions.',
    ).field,
  );
  const accessoryPictures = catalog.accessories.map(() => thumbnail('h-10 w-8'));
  body.row(
    'Accessory',
    choiceGrid<number | null>(
      [
        { value: null, label: '1', caption: '1 · None', picture: noneIcon('h-10 w-8') },
        ...catalog.accessories.map(({ id }, i) => ({
          value: id,
          label: String(id + 2),
          caption: `${id + 2} · ${ACCESSORY_NAMES[id] ?? 'Accessory'}`,
          picture: accessoryPictures[i],
        })),
      ],
      'grid-cols-8',
      () => outfit.accessory,
      (id) => (outfit.accessory = id),
      'Names are unofficial: the game only gives accessories a number.',
    ),
  );
  const paintSkins = whenChanged(
    () => [outfit.male, outfit.eyeColor],
    () => skinPictures.forEach((picture, skin) => paint(picture, renderer.render({ ...bare(), skin }), FULL_BODY)),
  );
  const paintAccessories = whenChanged(
    () => [outfit.male, outfit.skin, outfit.eyeColor, outfit.hairColor],
    () =>
      catalog.accessories.forEach(({ id }, i) =>
        paint(accessoryPictures[i], renderer.render({ ...bare(), accessory: id, hairColor: barsToRgb(outfit.hairColor) }), BUST),
      ),
  );
  body.paintWith(() => {
    paintSkins();
    paintAccessories();
  });

  const hair = section('Hair');
  const hairPictures = catalog.hairstyles.map(() => thumbnail('h-12 w-8'));
  hair.row(
    'Hair',
    choiceGrid(
      catalog.hairstyles.map((style, i) => ({ value: style.id, label: String(i + 1), picture: hairPictures[i] })),
      'grid-cols-8',
      () => outfit.hairstyle,
      (id) => (outfit.hairstyle = id),
    ),
  );
  hair.row(
    'Colour',
    colorBars(
      () => outfit.hairColor,
      (value) => {
        outfit.hairColor = value;
      },
      'In game: new game or the Shrine of Illusions.',
    ).field,
  );
  hair.paintWith(
    whenChanged(
      () => [outfit.male, outfit.skin, outfit.eyeColor, outfit.hairColor],
      () =>
        catalog.hairstyles.forEach((style, i) =>
          paint(
            hairPictures[i],
            renderer.render({ ...bare(), hairstyle: style.id, hairColor: barsToRgb(outfit.hairColor) }),
            HEAD,
          ),
        ),
    ),
  );

  const shirt = section('Shirt');
  const shirtColor = colorBars(
    () => outfit.shirtColor,
    (value) => {
      outfit.shirtColor = value;
    },
    "In game: Emily's dye pots.",
  );
  const syncShirtColor = () => {
    shirtColor.field.disabled = !catalog.shirts.find((item) => item.id === outfit.shirt)?.dyeable;
    shirtColor.sync();
  };
  document.addEventListener(OUTFIT_CHANGED, syncShirtColor);
  const shirtPictures = catalog.shirts.map(() => thumbnail('h-12 w-12'));
  shirt.row(
    'Shirt',
    choiceGrid(
      catalog.shirts.map((item, i) => {
        const number = shirtNumber(item);
        return {
          value: item.id,
          label: number,
          caption: newGameCaption(shirtLabels.get(item.id) ?? item.name, number),
          details: () => itemDetails(catalog, item, shirtNotes(item.id)),
          picture: shirtPictures[i],
        };
      }),
      'grid-cols-6',
      () => outfit.shirt,
      (id) => {
        outfit.shirt = id;
        const color = catalog.shirts.find((item) => item.id === id)?.color;
        if (color) outfit.shirtColor = rgbToBars(color);
        syncShirtColor();
      },
      undefined,
      createFilter(
        correctColors(
          'shirts',
          catalog.shirts.map((item) => ({
            id: item.id,
            name: shirtNames.get(item.id) ?? item.name,
            colors: shirtColors(textures, item),
            anyColor: item.dyeable || item.prismatic,
            dyeable: item.dyeable,
            creation: item.creation,
            tailorable: item.tailoring.length > 0,
            buyable: sold(item.sources),
          })),
        ),
        { dyeable: true, creation: true, obtain: true },
      ),
    ),
  );
  shirt.row('Colour', shirtColor.field);
  syncShirtColor();
  shirt.paintWith(
    whenChanged(
      () => [outfit.male, outfit.skin],
      () => catalog.shirts.forEach((item, i) => paint(shirtPictures[i], renderer.render({ ...bare(), shirt: item.id }), TORSO)),
    ),
  );

  const pants = section('Pants');
  const pantsColor = colorBars(
    () => outfit.pantsColor,
    (value) => {
      outfit.pantsColor = value;
    },
    "In game: new game or Emily's dye pots.",
  );
  const syncPantsColor = () => {
    pantsColor.field.disabled = !catalog.pants.find((item) => item.id === outfit.pants)?.dyeable;
  };
  document.addEventListener(OUTFIT_CHANGED, syncPantsColor);
  const pantsPictures = catalog.pants.map(() => thumbnail('h-12 w-12'));
  pants.row(
    'Pants',
    choiceGrid(
      catalog.pants.map((item, i) => {
        const number = pantsNumber(item);
        return {
          value: item.id,
          label: number,
          caption: newGameCaption(pantsLabels.get(item.id) ?? item.name, number),
          details: () => itemDetails(catalog, item, pantsNotes(item.id)),
          picture: pantsPictures[i],
        };
      }),
      'grid-cols-6',
      () => outfit.pants,
      (id) => {
        outfit.pants = id;
        syncPantsColor();
      },
      undefined,
      createFilter(
        correctColors(
          'pants',
          catalog.pants.map((item) => ({
            id: item.id,
            name: pantsNames.get(item.id) ?? item.name,
            colors: pantsColors(textures, item),
            anyColor: item.dyeable || item.prismatic,
            dyeable: item.dyeable,
            creation: item.creation,
            tailorable: item.tailoring.length > 0,
            buyable: sold(item.sources),
          })),
        ),
        { dyeable: true, creation: true, obtain: true },
      ),
    ),
  );
  pants.row('Colour', pantsColor.field);
  syncPantsColor();
  pants.paintWith(
    whenChanged(
      () => [outfit.male, outfit.skin],
      () => catalog.pants.forEach((item, i) => paint(pantsPictures[i], renderer.render({ ...bare(), pants: item.id }), LEGS)),
    ),
  );

  const hat = section('Hat');
  const hatPictures = catalog.hats.map(() => thumbnail('h-10 w-10'));
  hat.row(
    'Hat',
    choiceGrid<string | null>(
      [
        { value: null, caption: 'None', picture: noneIcon('h-10 w-10') },
        ...catalog.hats.map((item, i) => ({
          value: item.id,
          caption: hatLabels.get(item.id),
          details: () => itemDetails(catalog, item, hatNotes(item.id)),
          picture: hatPictures[i],
        })),
      ],
      'grid-cols-7',
      () => outfit.hat,
      (id) => (outfit.hat = id),
      undefined,
      createFilter(
        correctColors(
          'hats',
          catalog.hats.map((item) => ({
            id: item.id,
            name: hatNames.get(item.id) ?? item.name,
            colors: hatColors(textures, item),
            anyColor: item.prismatic,
            tailorable: item.tailoring.length > 0,
            buyable: sold(item.sources),
          })),
        ),
        { obtain: true },
      ),
    ),
  );
  hat.paintWith(
    whenChanged(
      () => [],
      () => catalog.hats.forEach((item, i) => paint(hatPictures[i], renderer.renderHat(item.id), WHOLE_HAT)),
    ),
  );

  const boots = section('Boots');
  const bootsPictures = catalog.boots.map(() => thumbnail('h-6 w-12'));
  boots.row(
    'Boots',
    choiceGrid<string | null>(
      [
        { value: null, caption: 'None', picture: noneIcon('h-6 w-12') },
        ...catalog.boots.map((item, i) => ({
          value: item.id,
          caption: bootsLabels.get(item.id),
          details: () => itemDetails(catalog, item, bootsNotes(item.id)),
          picture: bootsPictures[i],
        })),
      ],
      'grid-cols-6',
      () => outfit.boots,
      (id) => (outfit.boots = id),
      undefined,
      createFilter(
        correctColors(
          'boots',
          catalog.boots.map((item) => ({
            id: item.id,
            name: bootsNames.get(item.id) ?? item.name,
            colors: bootsColors(textures, catalog, item),
            anyColor: false,
            buyable: sold(item.sources),
          })),
        ),
        { obtain: true },
      ),
    ),
  );
  boots.paintWith(
    whenChanged(
      () => [outfit.male, outfit.skin],
      () => catalog.boots.forEach((item, i) => paint(bootsPictures[i], renderer.render({ ...bare(), boots: item.id }), FEET)),
    ),
  );

  const villagers = section('Villagers', true, 'tab-villagers');
  const villagerPictures = VILLAGERS.map(() => thumbnail('h-16 w-8'));
  let villager: string | null = null;
  villagers.row(
    'Villager',
    choiceGrid<string | null>(
      VILLAGERS.map((preset, i) => ({ value: preset.name, label: preset.name, picture: villagerPictures[i] })),
      'grid-cols-6',
      () => villager,
      (name) => {
        villager = name;
        const preset = VILLAGERS.find((entry) => entry.name === name);
        if (preset) Object.assign(outfit, villagerOutfit(catalog, preset, outfit));
        document.dispatchEvent(new Event(OUTFIT_CHANGED));
      },
      'Looks based on my own interpretation of each character.',
    ),
  );
  villagers.paintWith(
    whenChanged(
      () => [],
      () =>
        VILLAGERS.forEach((preset, i) =>
          drawSprite(villagerPictures[i], `${import.meta.env.BASE_URL}assets/Characters/${preset.sprite}.png`),
        ),
    ),
  );

  infos = sections.map(({ section }) =>
    [...section.querySelectorAll<HTMLElement>('[data-details]')].map((info) => ({
      info,
      home: info.parentElement!,
      next: info.nextSibling,
      redraw: previews.get(info),
    })),
  );
  wide.addEventListener('change', placeDetails);
  show(0);
  return {
    tabs,
    panel,
    howTo,
    refresh: () => {
      sections[active].paint();
      if (wide.matches) infos[active].forEach(({ redraw }) => redraw?.());
    },
  };
}

function choiceGrid<T>(
  choices: Choice<T>[],
  columns: string,
  selected: () => T,
  pick: (value: T) => void,
  note?: string,
  filter?: { bar: HTMLElement; matches: (value: T) => boolean; onChange: (listener: () => void) => void },
): HTMLElement {
  const field = document.createElement('div');
  field.className = 'flex flex-col gap-2';
  const grid = document.createElement('div');
  grid.className = `grid ${columns} gap-2 ${choices.length > 40 ? 'max-h-96 overflow-y-auto p-1' : ''}`;
  const labelled = choices.some((choice) => choice.label);
  const captioned = choices.some((choice) => choice.caption);
  const caption = document.createElement('p');
  caption.className = 'font-semibold';
  const details = document.createElement('div');
  details.className = 'w-0 min-w-full';
  const preview = document.createElement('canvas');
  preview.className = 'hidden self-start [image-rendering:pixelated] min-[1500px]:block';
  let described: Choice<T> | undefined;
  const drawPreview = () => {
    const source = described?.picture;
    if (!(source instanceof HTMLCanvasElement) || !source.width) {
      preview.hidden = true;
      return;
    }
    preview.hidden = false;
    if (preview.width !== source.width || preview.height !== source.height) {
      preview.width = source.width;
      preview.height = source.height;
      preview.style.width = `${source.width * 1.5}px`;
    }
    const context = preview.getContext('2d')!;
    context.clearRect(0, 0, preview.width, preview.height);
    context.drawImage(source, 0, 0);
  };
  const describe = (value: T) => {
    described = choices.find((entry) => entry.value === value);
    caption.textContent = described?.caption ?? '';
    details.replaceChildren(...(described?.details ? [described.details()] : []));
    drawPreview();
  };

  const buttons = choices.map((choice) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = OPTION;
    button.ariaLabel = choice.caption ?? choice.label ?? '';
    if (choice.caption) button.title = choice.caption;
    button.append(choice.picture);
    if (labelled) {
      const text = document.createElement('span');
      text.textContent = choice.label || ' ';
      button.append(text);
    }
    button.addEventListener('click', () => {
      pick(choice.value);
      sync();
    });
    if (captioned) {
      for (const event of ['mouseenter', 'focus']) button.addEventListener(event, () => describe(choice.value));
      for (const event of ['mouseleave', 'blur']) button.addEventListener(event, () => describe(selected()));
    }
    grid.append(button);
    return button;
  });

  const sync = () => {
    buttons.forEach((button, i) => (button.ariaPressed = String(choices[i].value === selected())));
    if (captioned) describe(selected());
  };
  sync();
  document.addEventListener(OUTFIT_CHANGED, sync);

  if (filter) {
    const count = document.createElement('p');
    count.className = 'text-xs text-black/60';
    const apply = () => {
      let shown = 0;
      let total = 0;
      buttons.forEach((button, i) => {
        const value = choices[i].value;
        const visible = filter.matches(value);
        button.hidden = !visible;
        if (value !== null) {
          total++;
          if (visible) shown++;
        }
      });
      count.textContent = shown === total ? `${total} items` : shown ? `${shown} of ${total}` : 'Nothing matches these filters.';
    };
    filter.onChange(apply);
    apply();
    field.append(filter.bar, count);
  }

  field.append(grid);
  if (choices.some((choice) => choice.details)) {
    const info = document.createElement('div');
    info.className = 'flex flex-col gap-2';
    info.dataset.details = '';
    info.append(preview, caption, details);
    previews.set(info, drawPreview);
    field.append(info);
  } else if (captioned) field.append(caption);
  if (note) {
    const text = document.createElement('p');
    text.className = 'text-xs italic text-black/60';
    text.textContent = note;
    field.append(text);
  }
  return field;
}

export function shirtNumber(item: Shirt): string {
  return item.creation ? String((item.sprite.y / 32) * 16 + item.sprite.x / 8 + 1) : '';
}

export function pantsNumber(item: Pants): string {
  return item.creation ? String((item.sprite.y / 688) * 10 + item.sprite.x / 192 + 1) : '';
}

function newGameCaption(name: string, number: string): string {
  return number ? `${name} · new game #${number}` : name;
}

function sold(sources: Source[]): boolean {
  return sources.some((source) => source.cost || source.trade);
}

function notesFor(kind: keyof typeof SOURCE_NOTES, names: Map<string, string>): (id: string) => string[] {
  const listed: Record<string, string[]> = SOURCE_NOTES[kind];
  const known = new Set(names.values());
  for (const name of Object.keys(listed)) if (!known.has(name)) console.warn(`item-sources.json: no ${kind} called "${name}"`);
  return (id) => listed[names.get(id) ?? ''] ?? [];
}

function itemDetails(catalog: Catalog, item: { tailoring?: Tailoring[]; sources: Source[] }, notes: string[]): HTMLElement {
  const element = document.createElement('div');
  element.className = 'flex flex-col gap-1';
  element.append(
    ...(item.tailoring ?? []).map((recipe) => tailoringLine(catalog, recipe)),
    ...item.sources.map((source) => sourceLine(catalog, source)),
    ...notes.map(noteLine),
  );
  if (!element.childElementCount) element.textContent = 'No known source.';
  return element;
}

function tailoringLine(catalog: Catalog, { base, items, farmer, random }: Tailoring): HTMLElement {
  const line = document.createElement('p');
  line.className = 'flex flex-wrap items-center gap-x-2 gap-y-1';
  line.append(bold('Sewing machine:'), ingredient(catalog, base ?? catalog.cloth), '+');
  if (items.length > 2) line.append('one of:');
  items.forEach((item, i) => {
    if (i && items.length === 2) line.append('or');
    line.append(ingredient(catalog, item));
  });
  if (farmer) line.append(`(${farmer} farmer)`);
  if (random) line.append('(random result)');
  return line;
}

function sourceLine(catalog: Catalog, { where, cost, trade, when }: Source): HTMLElement {
  const parts: (string | Node)[][] = [];
  if (cost) parts.push([cost]);
  if (trade) parts.push([`${trade.amount} × `, ingredient(catalog, trade.item)]);
  for (const condition of when ?? []) parts.push([condition]);
  const line = document.createElement('p');
  line.append(bold(`${where}:`), ' ');
  parts.forEach((part, i) => line.append(...(i ? [', '] : []), ...part));
  return line;
}

function noteLine(note: string): HTMLElement {
  const line = document.createElement('p');
  const split = note.indexOf(': ');
  line.append(...(split > 0 ? [bold(note.slice(0, split + 1)), note.slice(split + 1)] : [note]));
  return line;
}

function bold(text: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'font-semibold';
  element.textContent = text;
  return element;
}

function ingredient(catalog: Catalog, { name, icon }: Ingredient): HTMLElement {
  const sheet = catalog.icons[icon.texture];
  const picture = document.createElement('span');
  picture.ariaHidden = 'true';
  picture.className = 'shrink-0 [image-rendering:pixelated]';
  picture.style.width = picture.style.height = `${16 * ICON_SCALE}px`;
  picture.style.backgroundImage = `url(${import.meta.env.BASE_URL}${sheet.path})`;
  picture.style.backgroundPosition = `-${icon.x * ICON_SCALE}px -${icon.y * ICON_SCALE}px`;
  picture.style.backgroundSize = `${sheet.width * ICON_SCALE}px ${sheet.height * ICON_SCALE}px`;
  const chip = document.createElement('span');
  chip.className = 'inline-flex items-center gap-1 align-middle';
  chip.append(picture, name);
  return chip;
}

export function distinctNames(
  items: { id: string; name: string }[],
  withId = (name: string, id: string) => `${name} (${id})`,
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const { name } of items) counts.set(name, (counts.get(name) ?? 0) + 1);
  return new Map(items.map(({ id, name }) => [id, (counts.get(name) ?? 0) > 1 ? withId(name, id) : name]));
}

export function itemLabels(items: { id: string; name: string }[]): Map<string, string> {
  return distinctNames(items, (name, id) => `${name} · ID ${id}`);
}

function bodyArea(left: number, top: number, width: number, height: number): Rect {
  return { x: BODY_X + left * SCALE, y: BODY_Y + top * SCALE, width: width * SCALE, height: height * SCALE };
}

export function iconButton(label: string, icon: keyof typeof UI_ICONS, scale: number, className: string): HTMLButtonElement {
  const [width, height] = UI_ICONS[icon];
  const image = new Image(width * scale, height * scale);
  image.src = `${import.meta.env.BASE_URL}ui/${icon}.png`;
  image.alt = '';
  image.className = '[image-rendering:pixelated]';
  const button = document.createElement('button');
  button.type = 'button';
  button.ariaLabel = label;
  button.title = label;
  button.className = className;
  button.append(image);
  return button;
}

export function thumbnail(size: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = `${size} [image-rendering:pixelated]`;
  return canvas;
}

function noneIcon(size: string): HTMLElement {
  const icon = document.createElement('span');
  icon.className = `${size} text-gray-500`;
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/></svg>';
  return icon;
}

export function paint(canvas: HTMLCanvasElement, surface: Surface, area: Rect): void {
  canvas.width = area.width;
  canvas.height = area.height;
  canvas.getContext('2d')!.putImageData(new ImageData(surface.toStraightAlpha(), surface.width, surface.height), -area.x, -area.y);
}

export function whenChanged(key: () => unknown[], draw: () => void): () => void {
  let drawnFor: string | null = null;
  return () => {
    const next = JSON.stringify(key());
    if (next === drawnFor) return;
    drawnFor = next;
    draw();
  };
}

function drawSprite(canvas: HTMLCanvasElement, url: string): void {
  const image = new Image();
  image.addEventListener('load', () => {
    canvas.width = 16;
    canvas.height = 32;
    canvas.getContext('2d')!.drawImage(image, 0, 0, 16, 32, 0, 0, 16, 32);
  });
  image.src = url;
}

function colorBars(
  get: () => Bars,
  set: (value: Bars) => void,
  note: string,
): { field: HTMLFieldSetElement; sync: () => void } {
  const field = document.createElement('fieldset');
  field.className = 'flex flex-col gap-1 pt-1 disabled:opacity-30';
  const rows = document.createElement('div');
  rows.className = 'flex flex-col gap-1';
  const sliders = BAR_NAMES.map((name, i) => {
    const input = document.createElement('input');
    input.type = 'range';
    input.max = String(BAR_MAX);
    input.ariaLabel = name;
    input.className = 'color-bar w-40';
    const number = document.createElement('span');
    number.className = 'w-7 text-right font-semibold tabular-nums';
    input.addEventListener('input', () => {
      const bars: Bars = [...get()];
      bars[i] = Number(input.value);
      set(bars);
      sync();
    });
    const letter = document.createElement('span');
    letter.ariaHidden = 'true';
    letter.title = name;
    letter.className = 'w-3 text-xs font-semibold text-black/60';
    letter.textContent = name[0];
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.append(letter, input, number);
    rows.append(row);
    return { input, number };
  });
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.ariaLabel = 'Pick a colour';
  picker.title = 'Pick a colour or take one from the screen';
  picker.className =
    'h-9 w-9 cursor-pointer rounded border-2 border-[#8B4513] bg-transparent p-0 disabled:cursor-default [&::-moz-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0';
  picker.addEventListener('input', () => {
    set(rgbToBars(fromHex(picker.value)));
    showBars();
  });
  const showBars = () => {
    const bars = get();
    sliders.forEach(({ input, number }, i) => {
      input.style.background = barGradient(bars, i);
      input.value = String(bars[i]);
      number.textContent = String(bars[i]);
    });
  };
  const sync = () => {
    showBars();
    picker.value = toHex(barsToRgb(get()));
  };
  const dropper = new Image(21, 21);
  dropper.src = `${import.meta.env.BASE_URL}ui/eyedropper.png`;
  dropper.alt = '';
  dropper.className = 'pointer-events-none absolute inset-0 m-auto [image-rendering:pixelated]';
  const swatch = document.createElement('div');
  swatch.className = 'relative flex';
  swatch.append(picker, dropper);
  const controls = document.createElement('div');
  controls.className = 'flex items-center gap-3';
  controls.append(rows, swatch);
  const hint = document.createElement('p');
  hint.className = 'text-xs italic text-black/60';
  hint.textContent = note;
  field.append(controls, hint);
  sync();
  document.addEventListener(OUTFIT_CHANGED, sync);
  return { field, sync };
}

export function barGradient([hue, saturation, value]: Bars, index: number): string {
  const degrees = (hue / 100) * 360;
  const color = [
    (step: number) => hsvToRgb(step * 360, 0.9, 0.9),
    (step: number) => hsvToRgb(degrees, step, value / 100),
    (step: number) => hsvToRgb(degrees, saturation / 100, step),
  ][index];
  return `linear-gradient(to right, ${Array.from({ length: 24 }, (_, i) => toHex(color(i / 24))).join(', ')})`;
}
