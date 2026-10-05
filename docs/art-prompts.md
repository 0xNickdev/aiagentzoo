# Промпты для животных

Стиль взят из видео на первом экране: чистый чёрный фон, коряга со мхом, стеклянная сфера, приглушённый боковой свет.

**Формат:** 4:5, вертикально, от 1600 px по высоте.
**Куда класть:** `public/animals/`, имена файлов строго такие:

| Вид | Животное | Файл |
|---|---|---|
| Дозорный | сова | `sentinel.jpg` |
| Сборщик | ёж | `gatherer.jpg` |
| Строитель | бобр | `builder.jpg` |
| Архивариус | черепаха | `archivist.jpg` |

Пока файла нет, в карточке показывается стеклянная сфера-заглушка. Когда файл появится, страница подхватит его без правок кода.

Важно: животное должно стоять в нижних двух третях кадра, верх оставьте пустым и тёмным. Снизу на картинку ложится текст.

---

## Общий стиль (уже вставлен в каждый промпт)

```
pitch-black void background, low-key studio lighting, single soft rim light from upper left,
gnarled moss-covered driftwood, a perfectly clear glass sphere, muted desaturated palette,
cinematic macro photography, 85mm lens, shallow depth of field, fine natural texture,
photorealistic, editorial nature documentary, vertical 4:5 composition,
subject in lower two thirds, empty dark negative space above
```

**Negative:** `text, logo, watermark, bright background, colorful, cartoon, illustration, 3d render look, oversaturated, multiple animals, cropped subject, blurry eyes`

---

## 1. Дозорный — сова

```
A great grey owl perched on a twisted moss-covered driftwood branch, head turned three-quarters,
wide alert eyes glowing faint amber — the only warm color in the frame — scanning the darkness.
A perfectly clear glass sphere rests on the branch beside it, reflecting the owl's face in miniature.
Feathers catch a thin silver rim light. Pitch-black void background, low-key studio lighting,
single soft rim light from upper left, muted desaturated palette, cinematic macro photography,
85mm lens, shallow depth of field, photorealistic, editorial nature documentary,
vertical 4:5, subject in lower two thirds, empty dark negative space above.
```

## 2. Сборщик — ёж

```
A small hedgehog walking along a gnarled moss-covered driftwood log, carrying tiny clear glass beads
and dew droplets caught on the tips of its spines like collected data.
A perfectly clear glass sphere lies just ahead of it, refracting the log and the hedgehog's snout.
Soft silver rim light outlines every spine. Pitch-black void background, low-key studio lighting,
single soft rim light from upper left, muted desaturated palette, cinematic macro photography,
85mm lens, shallow depth of field, photorealistic, editorial nature documentary,
vertical 4:5, subject in lower two thirds, empty dark negative space above.
```

## 3. Строитель — бобр

```
A beaver sitting on a moss-covered driftwood stump, carefully placing a thin peeled twig into
a small precise geometric lattice structure it is building — clean angles, almost architectural.
A perfectly clear glass sphere is half embedded in the twig structure like a cornerstone.
Wet fur with a thin silver rim light. Pitch-black void background, low-key studio lighting,
single soft rim light from upper left, muted desaturated palette, cinematic macro photography,
85mm lens, shallow depth of field, photorealistic, editorial nature documentary,
vertical 4:5, subject in lower two thirds, empty dark negative space above.
```

## 4. Архивариус — черепаха

```
An ancient tortoise resting on a gnarled moss-covered driftwood root, its weathered shell
patterned with faint concentric growth rings like an engraved archive record.
A perfectly clear glass sphere balances on top of the shell, reflecting the whole scene upside down.
Slow, calm, patient presence; thin silver rim light along the shell edge. Pitch-black void background,
low-key studio lighting, single soft rim light from upper left, muted desaturated palette,
cinematic macro photography, 85mm lens, shallow depth of field, photorealistic,
editorial nature documentary, vertical 4:5, subject in lower two thirds, empty dark negative space above.
```

---

## Если захотите оживить (image-to-video, 5 с, цикл)

Берёте готовую картинку как первый кадр и добавляете движение:

- **Сова:** `slow head turn from left to right, eyes blink once, feathers ruffle slightly, glass sphere reflection shifts, static camera, seamless loop`
- **Ёж:** `hedgehog takes two small steps forward, dew beads on spines glint, subtle sniffing, static camera, seamless loop`
- **Бобр:** `beaver slowly presses a twig into the lattice, paws adjust it, small head tilt, static camera, seamless loop`
- **Черепаха:** `tortoise slowly blinks and lifts its head slightly, light glides across the shell rings, static camera, seamless loop`

Общая приписка к видео: `very slow subtle motion, no camera movement, pitch-black background stays black, cinematic`.
Видео сохраняйте как `sentinel.mp4` и т.д. рядом с картинками и скажите мне: я переключу карточки на видео.

---

# Карта «Ночной дозор»: зоны и агенты

Формат для всех: **1:1**. Кидайте PNG как есть: переименую, пережму и разложу сам.
Чёрный фон вырезать не нужно: карта накладывает картинки так, что чёрное становится прозрачным.

## Зоны (вид строго сверху, круглый «остров» в чёрной пустоте)

Общая часть уже вставлена в каждый промпт. Центр делаем спокойным и тёмным, потому что по нему ходят агенты и поверх идут подписи.

### Northern Edge — лесная опушка
```
Strict top-down aerial view of a small circular patch of night forest edge floating in a pitch-black void,
the edges dissolve softly into pure black. Dark mossy forest floor, scattered ferns, fallen gnarled branches,
tiny mushrooms, a few pale stones. Faint cool moonlight, low-key, muted desaturated greens.
Calm uncluttered center, details concentrated toward the rim. Photorealistic miniature diorama,
macro tilt-shift, high detail, no horizon, no sky, square 1:1.
```

### Quiet Marsh — болото
```
Strict top-down aerial view of a small circular marsh floating in a pitch-black void,
the edges dissolve softly into pure black. Still black water pools with a faint reflection of the moon,
clusters of reeds and sedge, lily pads, wet moss islands, thin mist over the water.
Faint cool moonlight, low-key, muted teal and grey palette. Calm uncluttered center,
details concentrated toward the rim. Photorealistic miniature diorama, macro tilt-shift,
high detail, no horizon, no sky, square 1:1.
```

### Stone Canyon — каньон
```
Strict top-down aerial view of a small circular stone canyon floating in a pitch-black void,
the edges dissolve softly into pure black. Layered weathered sandstone ridges, a dry winding riverbed
with smooth pebbles, sparse dry grass and one twisted dead tree. Faint warm moonlight, low-key,
muted ochre and bone palette. Calm uncluttered center, details concentrated toward the rim.
Photorealistic miniature diorama, macro tilt-shift, high detail, no horizon, no sky, square 1:1.
```

**Negative для зон:** `perspective view, horizon, sky, text, labels, map icons, grid, UI, bright colors, daylight, people, buildings, square edges, frame`

## Агенты (6 штук, портрет головы внутри стеклянной сферы)

На карте агенты маленькие, 40–50 px, поэтому крупно только голова. Стеклянная сфера повторяет видео на первом экране.

Общая часть (вставлена в каждый):
```
inside a perfectly clear glass sphere, centered, the sphere fills 80% of the frame,
pitch-black void background, thin silver rim light on the glass edge, soft inner reflection,
low-key studio lighting, muted desaturated palette, photorealistic macro, square 1:1
```

1. **Raven** → `raven`
```
Portrait of a raven's head and shoulders, glossy black feathers with a faint blue sheen, sharp alert eye,
inside a perfectly clear glass sphere, centered, the sphere fills 80% of the frame, pitch-black void background,
thin silver rim light on the glass edge, soft inner reflection, low-key studio lighting,
muted desaturated palette, photorealistic macro, square 1:1
```
2. **Owl** → `owl`
```
Portrait of a great grey owl's face, concentric facial disc, amber eyes as the only warm color,
inside a perfectly clear glass sphere, centered, the sphere fills 80% of the frame, pitch-black void background,
thin silver rim light on the glass edge, soft inner reflection, low-key studio lighting,
muted desaturated palette, photorealistic macro, square 1:1
```
3. **Hedgehog** → `hedgehog`
```
Portrait of a hedgehog's face and front spines with tiny dew droplets on the tips,
inside a perfectly clear glass sphere, centered, the sphere fills 80% of the frame, pitch-black void background,
thin silver rim light on the glass edge, soft inner reflection, low-key studio lighting,
muted desaturated palette, photorealistic macro, square 1:1
```
4. **Otter** → `otter`
```
Portrait of a river otter's head with wet sleek fur and whiskers, curious expression,
inside a perfectly clear glass sphere, centered, the sphere fills 80% of the frame, pitch-black void background,
thin silver rim light on the glass edge, soft inner reflection, low-key studio lighting,
muted desaturated palette, photorealistic macro, square 1:1
```
5. **Beaver** → `beaver`
```
Portrait of a beaver's head with wet brown fur, holding a thin peeled twig in its teeth,
inside a perfectly clear glass sphere, centered, the sphere fills 80% of the frame, pitch-black void background,
thin silver rim light on the glass edge, soft inner reflection, low-key studio lighting,
muted desaturated palette, photorealistic macro, square 1:1
```
6. **Tortoise** → `tortoise`
```
Portrait of an ancient tortoise's head and the front edge of its ringed shell, calm wise eyes,
inside a perfectly clear glass sphere, centered, the sphere fills 80% of the frame, pitch-black void background,
thin silver rim light on the glass edge, soft inner reflection, low-key studio lighting,
muted desaturated palette, photorealistic macro, square 1:1
```

**Negative для агентов:** `full body, multiple animals, background scenery, text, logo, cartoon, bright colors, cracked glass, cropped sphere`
