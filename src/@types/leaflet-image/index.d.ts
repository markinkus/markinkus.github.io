declare module 'leaflet-image' {
  import * as L from 'leaflet';
  /**
   * Trasforma una mappa Leaflet in un <canvas> che include tiles, SVG, marker, polilinee…
   */
  function leafletImage(
    map: L.Map,
    callback: (err: any, canvas: HTMLCanvasElement) => void
  ): void;
  export default leafletImage;
}
