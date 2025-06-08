interface Coordinates {
  latitude: number;
  longitude: number;
}

export class LocationGenerator {
  // Convertir distancia en km a grados (aproximadamente)
  private kmToLat = (km: number) => km / 111.32;
  private kmToLng = (km: number, lat: number) =>
    km / (111.32 * Math.cos(lat * (Math.PI / 180)));

  constructor(
    private centerLat: number,
    private centerLng: number,
    private radiusKm: number,
    private numPoints: number = 8,
  ) {
    if (radiusKm <= 0) throw new Error('Radius must be greater than 0');
    if (numPoints < 1) throw new Error('Number of points must be at least 1');
    if (centerLat < -90 || centerLat > 90) throw new Error('Invalid latitude');
    if (centerLng < -180 || centerLng > 180)
      throw new Error('Invalid longitude');
  }

  // Generar puntos en espiral para mejor cobertura
  generatePoints(): Coordinates[] {
    const points: Coordinates[] = [];
    const spirals = 3; // Número de vueltas en la espiral

    for (let i = 0; i < this.numPoints; i++) {
      // Usar ecuaciones paramétricas de espiral
      const angle = (i / this.numPoints) * Math.PI * 2 * spirals;
      const distance = (i / this.numPoints) * this.radiusKm;

      const latOffset = this.kmToLat(distance * Math.cos(angle));
      const lngOffset = this.kmToLng(
        distance * Math.sin(angle),
        this.centerLat,
      );

      points.push({
        latitude: this.centerLat + latOffset,
        longitude: this.centerLng + lngOffset,
      });
    }

    return points;
  }
}
