# The Overworld dashboard theme

The Minecraft-inspired theme uses original code-drawn tool icons and an original isometric camp illustration, with beveled controls, inventory slots, stone frames and grass colours. The camp banner is decorative; the construction panel remains a live, labelled builder survey. All connection, inventory, task, network, roster and outage data still comes from the existing relay.

Visual reference: [MCdle patchnotes #21](https://www.mcdle.net/en_gb/patchnotes/patch-21). No MCdle images, Minecraft textures or logos are bundled.

Headings use **Pixelify Sans**, designed by Stefie Justprince, distributed through [Google Fonts](https://github.com/google/fonts/tree/main/ofl/pixelifysans) under the SIL Open Font License. The Latin WOFF2 font is self-hosted in `src/assets/`, alongside its full license. Interface text uses the system sans-serif stack for readable telemetry. No runtime font CDN is required.

`src/minecraft-theme.css` layers the theme over the existing structural styles. The artwork and font are imported through Vite, so they receive hashed `/assets/` URLs supported by the existing server. No backend restart, additional service or Minecraft change is required. Native buttons, checkboxes, selects, focus outlines, labelled dialogs and reduced-motion behaviour are retained. Phone cards stack in one column to keep tasks and statuses readable.
