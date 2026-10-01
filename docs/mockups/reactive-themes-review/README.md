# Reactive theme companions — design review

Open `http://127.0.0.1:5174/reactive-themes.html`.

- **A / Play corners:** compact cushioned cat trees, snowman, stump squirrel, Marshawn-inspired Skittles scene.
- **B / Little habitats:** shared cat bench, snowman family, autumn fox, Marshawn-inspired Skittles scene.

These native HTML/SVG prototypes use the approved light/dark theme palettes and shared mobile foundation. They do not write product preferences. Product implementation waits for the design pick per `.cursor/skills/fast-ui-mock/SKILL.md`.

Falling decorations, companion habitats, and toy reactions have separate switches. Turning companions off removes the habitat and hit areas while retaining the falling field. Turning both decoration layers off preserves just the palette. Reactions respond only to dragging or keyboard manipulation of the local toy. Reduced motion stops particles and removes interaction targets.

Each toy moves freely within a square. Releasing a hanging toy starts a damped elastic-tether swing; loose objects fall, bounce, and slow to rest with gravity and friction. Toy hit areas follow their objects throughout the motion. Both cats track the toy in screen coordinates, including the mirrored right cat. Marshawn's grin appears when the Skittles approach his hand. Turning reactions off cancels any active physics.

Validation: 40 combinations of option, theme, mode, and desktop/phone width; both cats' rendered eye direction; square corners and release physics for each themed prop; Skittles proximity; independent switches; reduced motion; native disclosure; option navigation; 320px long account heading. Layout gates (type, selects, collisions, grids) pass for both options at 390px and 1280px. Screenshots were inspected at 390px, 1280px, and 320px.

Refresh screenshots and checks with `node scripts/dev/reactive_themes_preview.mjs`.
