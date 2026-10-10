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

## 1. Дозорный - сова

```
A great grey owl perched on a twisted moss-covered driftwood branch, head turned three-quarters,
wide alert eyes glowing faint amber - the only warm color in the frame - scanning the darkness.
A perfectly clear glass sphere rests on the branch beside it, reflecting the owl's face in miniature.
Feathers catch a thin silver rim light. Pitch-black void background, low-key studio lighting,
single soft rim light from upper left, muted desaturated palette, cinematic macro photography,
85mm lens, shallow depth of field, photorealistic, editorial nature documentary,
vertical 4:5, subject in lower two thirds, empty dark negative space above.
```

## 2. Сборщик - ёж

```
A small hedgehog walking along a gnarled moss-covered driftwood log, carrying tiny clear glass beads
and dew droplets caught on the tips of its spines like collected data.
A perfectly clear glass sphere lies just ahead of it, refracting the log and the hedgehog's snout.
Soft silver rim light outlines every spine. Pitch-black void background, low-key studio lighting,
single soft rim light from upper left, muted desaturated palette, cinematic macro photography,
85mm lens, shallow depth of field, photorealistic, editorial nature documentary,
vertical 4:5, subject in lower two thirds, empty dark negative space above.
```

## 3. Строитель - бобр

```
A beaver sitting on a moss-covered driftwood stump, carefully placing a thin peeled twig into
a small precise geometric lattice structure it is building - clean angles, almost architectural.
A perfectly clear glass sphere is half embedded in the twig structure like a cornerstone.
Wet fur with a thin silver rim light. Pitch-black void background, low-key studio lighting,
single soft rim light from upper left, muted desaturated palette, cinematic macro photography,
85mm lens, shallow depth of field, photorealistic, editorial nature documentary,
vertical 4:5, subject in lower two thirds, empty dark negative space above.
```

## 4. Архивариус - черепаха

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

### Northern Edge - лесная опушка
```
Strict top-down aerial view of a small circular patch of night forest edge floating in a pitch-black void,
the edges dissolve softly into pure black. Dark mossy forest floor, scattered ferns, fallen gnarled branches,
tiny mushrooms, a few pale stones. Faint cool moonlight, low-key, muted desaturated greens.
Calm uncluttered center, details concentrated toward the rim. Photorealistic miniature diorama,
macro tilt-shift, high detail, no horizon, no sky, square 1:1.
```

### Quiet Marsh - болото
```
Strict top-down aerial view of a small circular marsh floating in a pitch-black void,
the edges dissolve softly into pure black. Still black water pools with a faint reflection of the moon,
clusters of reeds and sedge, lily pads, wet moss islands, thin mist over the water.
Faint cool moonlight, low-key, muted teal and grey palette. Calm uncluttered center,
details concentrated toward the rim. Photorealistic miniature diorama, macro tilt-shift,
high detail, no horizon, no sky, square 1:1.
```

### Stone Canyon - каньон
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

---

# Фоны секций и широкие полосы

Задача - убрать «голую черноту», сохранив кино-эстетику видео: ночь, мох, коряги, стеклянные сферы, лунный свет. Тона - глубокий мох, сине-серый, тёплый янтарь, **не чистый чёрный**.

Сайт сам растворяет края картинок в странице и затемняет центр под текстом, так что края кадра могут быть насыщенными.

| Файл (в `apps/web/public/backdrops/`) | Где | Формат |
|---|---|---|
| `species-base` | Виды, основной фон | 16:9 |
| `species-reveal` | Виды, проявляется под курсором | 16:9, **тот же кадр** |
| `watch` | Ночной дозор | 16:9 |
| `cycle` | Цикл | 16:9 |
| `token` | Токен | 16:9 |
| `roadmap` | Путь | 16:9 |
| `strip-nightfall` | Полоса «Nightfall» | 21:9 |
| `strip-spheres` | Полоса «Every step leaves a trace» | 21:9 |

**Общая негативная часть для всех:**
```
pure black background, flat black, text, letters, logo, watermark, UI, frame, border, people, buildings, cartoon, illustration, anime, 3d render look, plastic, oversaturated, neon, HDR halos, lens flare spam, harsh daylight, blurry, low detail, jpeg artifacts
```

## 1. species-base - ночная поляна (16:9)
```
Wide cinematic establishing shot of an ancient forest clearing at night, eye-level, 35mm lens.
Gnarled moss-covered driftwood and fallen logs frame the left and right thirds; carpets of deep green moss,
curled ferns, small pale mushrooms and smooth river stones on the ground. Low silver mist hangs between the trees.
Cool moonlight falls from upper left through a gap in the canopy, rim-lighting moss and bark.
A few perfectly clear glass spheres rest on the moss at different distances, catching tiny moon reflections.
Deep moss-green and slate-blue night palette, rich shadow detail, never pure black, gentle film grain.
The central third is calm, softer and darker for text overlay. Photorealistic, editorial nature documentary,
fine natural texture, high dynamic range in the shadows, 16:9.
```

## 2. species-reveal - тот же кадр, «скрытая жизнь» (16:9)
**Генерировать с картинкой №1 как референсом (image-to-image, сила изменения ~0.45–0.55), чтобы композиция совпала до пикселя:** эффект строится на том, что под курсором «проявляется» второй слой.
```
Exactly the same forest clearing, same camera, same composition and same objects as the reference image,
now revealing its hidden living network: the moss glows with soft bioluminescent cyan-green light,
hair-thin luminous mycelium threads run along the ground and up the driftwood, connecting every glass sphere,
and each glass sphere glows from inside with warm amber light like a sleeping lantern.
Dozens of tiny fireflies hang in the mist. Same moonlight from upper left. Magical but photorealistic,
restrained, no neon, no fantasy creatures, deep moss-green and slate-blue palette with amber accents,
central third calmer for text overlay, 16:9.
```

## 3. watch - долина с тремя вольерами (16:9)
```
High aerial view at night of a misty forested valley, looking down at a 60-degree angle.
Three distinct clearings far apart: on the left a mossy forest edge, top right a still marsh with black water
reflecting the moon, bottom centre a pale stone canyon. Hair-thin threads of soft white light arc between
the three clearings like a quiet network. Rolling fog fills the valley between them, treetops in deep green
and blue-grey moonlight, a faint warm glow in each clearing. Calm, vast, cinematic, never pure black,
low-contrast centre for UI overlay, photorealistic aerial cinematography, 16:9.
```

## 4. cycle - следы на мху (16:9)
```
Macro photograph at blue hour of wet emerald moss on an old log. A trail of tiny animal footprints pressed
into the moss leads from the left edge toward a single perfectly clear glass sphere on the right third,
which refracts the scene upside down. Dew drops on every moss tip catch cool light; a few droplets are
mid-fall with tiny ripples in a small puddle. Shallow depth of field, soft bokeh of more dew behind.
Deep moss-green and slate-blue palette, one soft warm highlight inside the sphere, never pure black,
calm darker centre for text, ultra-detailed macro, 100mm macro lens, photorealistic, 16:9.
```

## 5. token - сферы с янтарным светом (16:9)
```
Close cinematic still life in a mossy stone niche at night: seven perfectly clear glass spheres of different sizes
resting on velvet moss and weathered stone, each filled with a different amount of warm amber light like stored energy,
from almost empty to brimming. The light spills onto the moss and stone in soft pools. Thin silver rim light on the glass,
faint mist in the background, gnarled driftwood framing the edges. Warm amber and deep moss-green palette with
slate-blue shadows, never pure black, calm darker centre for text overlay, shallow depth of field, 50mm lens,
photorealistic, luxurious and restrained, 16:9.
```

## 6. roadmap - тропа перед рассветом (16:9)
```
A narrow winding path through an old forest just before dawn, eye-level, receding into soft fog.
Along the path, at regular intervals, glass spheres sit on moss-covered stones, each with a faint inner glow,
like waymarks leading into the distance. Tall dark trunks, ferns at the edges, the sky at the end of the path
turning from deep blue to the first hint of pale gold. Atmospheric perspective, layered mist, cool blue and moss-green
palette warming toward the horizon, never pure black, calm centre for text, photorealistic, cinematic, 35mm, 16:9.
```

## 7. strip-nightfall - панорама сумерек (21:9)
```
Ultra-wide panoramic shot of a forest canopy at nightfall seen from a ridge: layers of treetops fading into mist,
the sky a deep gradient from dusky indigo at the top to soft slate-blue near the horizon, a pale moon half-hidden
behind thin clouds. A few tiny warm lights glow deep within the forest, far apart, like enclosures waking up.
Calm, vast, quiet, slow. Deep indigo, slate-blue and moss-green palette, never pure black, fine detail in the
canopy, horizon slightly below centre, empty calm centre for a headline, photorealistic landscape photography, 21:9.
```

## 8. strip-spheres - ряд сфер на коряге (21:9)
```
Ultra-wide macro panorama along a long moss-covered fallen log at night: a row of perfectly clear glass spheres
of slightly different sizes resting on the moss, receding into soft focus toward both edges. Each sphere holds
a faint warm amber glow; fireflies drift above; tiny footprints and dew trace a path between the spheres.
Shallow depth of field with the central spheres in crisp focus, creamy bokeh beyond. Moss-green, slate-blue and
amber palette, never pure black, calm centre for a headline, ultra-detailed, photorealistic macro, 21:9.
```

## Если захочется движения
Любой фон можно оживить image-to-video на 6–8 секунд с бесшовным циклом:
```
very slow subtle motion: mist drifting left to right, fireflies floating, light flickering gently inside the glass spheres,
static camera, no zoom, seamless loop, the composition stays exactly the same
```
Присылайте видео `.mp4`, я подключу их вместо картинок.
