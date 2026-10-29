# PROJECT NEURO — Original Connectome Edition

This edition upgrades the earlier prototype to use the **original open-source FlyBrain simulation engine and its real FlyWire-derived connectome data**.

## What it uses
- Original project: https://github.com/snedea/flybrain
- Original leaky integrate-and-fire Web Worker, loaded from jsDelivr.
- Original `neuron_meta.json` and `connectome.bin.gz`, loaded from the public repository through jsDelivr.
- The public connectome dataset describes 139,255 neurons and 2,698,236 connections.
- Three.js renders a procedural 3D fruit fly, food, light source, threats, and habitat.
- Sensory stimuli are sent to sampled neurons in the actual connectome groups for vision, food odor, danger odor, touch/air, and taste.
- The 3D motor readout maps available neural group activity to heading and movement. Some motor/VNC groups in this brain dataset are absent or incomplete, so this is not a full biological motor-system emulation.

## Run locally
JavaScript workers and network requests need a local web server. Do not open `index.html` directly with `file://`.

**VS Code:** install Live Server, right-click `index.html`, choose **Open with Live Server**.

**Python:** open a terminal in this folder and run:
```bash
python -m http.server 8000
```
Then visit `http://localhost:8000`.

## Deploy on GitHub Pages
1. Create a public repository.
2. Upload the contents of this ZIP to the repository root (keep the `js` folder).
3. Open **Settings → Pages**.
4. Select **Deploy from a branch**, choose `main` and `/(root)`, then Save.
5. Wait for the site to publish.

## Controls
- Drag the 3D habitat to orbit; scroll to zoom.
- **Add food** creates a food odor source.
- **Add threat** creates a danger odor source.
- **Light intensity** changes visual sensory stimulation.
- **Danger odor** changes the threat stimulus strength.
- Click the fly or press **Touch the fly** to stimulate mechanosensory groups.
- Pause/resume the 3D habitat or reset the simulation.

## Network and performance notes
- The first load downloads about 12 MB of compressed connectome data, plus metadata.
- Three.js, the worker source, and the connectome data load from public CDNs, so an internet connection is required.
- The original worker simulates the connectome; this app samples a bounded set of neurons in relevant groups for external sensory stimulation to avoid sending enormous stimulus arrays every frame.
- Actual neural activity is visualized by group-level signal meters. The 3D movement layer is a readout of available neural activity plus sensory-gradient information; it is not a claim that all motor behavior is produced solely by the connectome.

## Attribution and license
See `ATTRIBUTION.md`. The original FlyBrain code is MIT-licensed. This project is a derivative integration with a separate 3D habitat UI.
