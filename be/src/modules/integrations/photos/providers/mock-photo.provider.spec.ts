import { MockPhotoProvider } from "./mock-photo.provider";

describe("MockPhotoProvider", () => {
  let provider: MockPhotoProvider;

  beforeEach(() => {
    provider = new MockPhotoProvider();
  });

  it("should enrich activity with mock photos and highlights", async () => {
    const result = await provider.enrichActivity({
      name: "Palacio Barolo",
      category: "cultural",
      destinationName: "Buenos Aires",
    });

    expect(result.status).toBe("enriched");
    expect(result.photos.length).toBeGreaterThan(0);
    expect(result.photos[0].url).toContain("http");
    expect(result.highlights?.length).toBeGreaterThan(0);
    expect(result.curatorTip).toBeDefined();
    expect(result.provider).toBe("mock");
  });

  it("should handle batch enrichment", async () => {
    const results = await provider.enrichBatch([
      { id: "1", name: "Lugar A" },
      { id: "2", name: "Lugar B" },
    ]);

    expect(results.size).toBe(2);
    expect(results.get("1")?.status).toBe("enriched");
    expect(results.get("2")?.status).toBe("enriched");
  });
});
