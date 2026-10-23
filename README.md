# Rip Curl Store – Digitaler Rundgang

Digitaler 3D-Rundgang durch den Surfshop-Entwurf von **Strasser & Steinacher** (GSU 5AHIHR).
Im Browser begehbar (Treppe ins Obergeschoss inklusive) und mit VR-Brille (WebXR, z. B. Meta Quest).

## Steuerung
- **Computer:** ins Bild klicken, Maus = umschauen, `W A S D` / Pfeiltasten = gehen, `Shift` = schneller, `Esc` = Maus freigeben
- **Handy/Tablet:** linker Joystick = gehen, rechts wischen = umschauen
- **VR-Brille:** Seite im Browser der Brille öffnen → „Mit VR-Brille starten“. Linker Stick gehen, rechter Stick drehen, Trigger halten/loslassen = teleportieren
- Oben über die **Stationen** direkt zu Eingang, Verkaufsraum, Treppe, Obergeschoss, Lounge oder Außenansicht springen

## Technik
- Modell: pCon.planner-DXF → eigene Konvertierung zu glTF (MESH, Blöcke, ACIS-Volumenkörper, Bilder), Deko-Objekte optimiert
- Darstellung: [three.js](https://threejs.org) r169 (lokal eingebunden), PBR-Materialien, Sonnenschatten, Umgebungslicht, Ambient Occlusion am Desktop
- Hosting: GitHub Pages (statisch, keine Build-Schritte)
