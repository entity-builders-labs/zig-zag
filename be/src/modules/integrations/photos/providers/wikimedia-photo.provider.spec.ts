import { WikimediaPhotoProvider } from "./wikimedia-photo.provider";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("WikimediaPhotoProvider", () => {
  let provider: WikimediaPhotoProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new WikimediaPhotoProvider();
  });

  it("should enrich activity from Wikipedia pageimages and extract", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        query: {
          pages: {
            "123": {
              pageid: 123,
              title: "Palacio Barolo",
              extract: "El Palacio Barolo es un rascacielos histórico ubicado sobre la Avenida de Mayo en Buenos Aires. Fue diseñado por Mario Palanti.",
              thumbnail: {
                source: "https://upload.wikimedia.org/thumb/barolo.jpg",
                width: 400,
                height: 300,
              },
              original: {
                source: "https://upload.wikimedia.org/barolo.jpg",
                width: 1200,
                height: 900,
              },
            },
          },
        },
      },
    });

    const result = await provider.enrichActivity({
      name: "Palacio Barolo",
      category: "cultural",
    });

    expect(result.status).toBe("enriched");
    expect(result.photos.length).toBe(1);
    expect(result.photos[0].url).toBe("https://upload.wikimedia.org/barolo.jpg");
    expect(result.photos[0].license).toBe("CC BY-SA 4.0");
    expect(result.highlights?.length).toBeGreaterThan(0);
    expect(result.curatorTip).toContain("Monumento histórico");
  });

  it("should handle Wikipedia API failure gracefully", async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await provider.enrichActivity({
      name: "Monumento Raro",
    });

    expect(result.status).toBe("failed");
    expect(result.photos.length).toBe(0);
  });
});
