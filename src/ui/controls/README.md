# BLine UI Controls

This directory owns BLine's reusable editor controls. BLine Web is a dense
technical editor, so the control system is intentionally compact and native
where possible. Do not add a third-party UI library or import third-party
primitives directly into feature code without first wrapping them here.

## Use The Shared Controls

Import from `src/ui/controls`; `Controls.tsx` is the canonical implementation:

```tsx
import { CloseButton, NumberStepperControl, SwitchInput } from "../controls";
```

Use these controls by default:

| Situation                                                  | Control                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Text command such as Save, Split, Cancel, or Delete        | `ActionButton`                                                                            |
| Icon-only command such as add, remove, edit, open, or copy | `IconButton`                                                                              |
| Dialog or popout close affordance                          | `CloseButton`                                                                             |
| Binary setting with on/off meaning                         | `SwitchInput`                                                                             |
| Simple enum choice backed by a native select               | `SelectControl`                                                                           |
| Numeric editor value with step buttons                     | `NumberStepperControl`                                                                    |
| Existing sidebar callsites                                 | `SidebarIconButton`, `SidebarActionButton`, `SidebarSelectControl` compatibility wrappers |

Plain native checkboxes are still correct for multi-select, label
membership, delete selections, and list inclusion. Those are not switches.

## Accessibility Contract

- Icon-only buttons must have a specific accessible name through `aria-label`.
- `CloseButton` labels should name the thing being closed, such as
  `Close config` or `Close Constraint Editor`.
- `SwitchInput` is for true on/off settings and exposes switch semantics.
- Keep existing accessible names stable unless the user-facing action changes.
- Preserve keyboard behavior for `NumberStepperControl`: ArrowUp/ArrowDown step,
  Enter commits, Escape reverts, and blur commits valid drafts.

## Styling Contract

- Shared control dimensions, tones, focus, disabled, and hover states live in
  `AppShell.css` under the `bline-*` control classes.
- Feature CSS may control layout, grid placement, and component-specific menu or
  dialog composition.
- Do not draw plus, minus, remove, or close symbols with CSS. Reuse
  `src/ui/icons.tsx` for existing BLine icons and `lucide-react` for new editor
  symbols so controls keep one consistent stroke family.
- Add a new tone or size only when at least two callsites need it.

## Third-Party Policy

No third-party component or primitive library is used for the control layer
today. Native/custom controls are sufficient for the current editor and keep
the interaction model small. `lucide-react` is the shared icon source, not a
control framework.

If a future interaction becomes complex enough to justify a dependency, add it
behind these BLine wrappers. Feature code should still import BLine controls,
not raw external primitives.
