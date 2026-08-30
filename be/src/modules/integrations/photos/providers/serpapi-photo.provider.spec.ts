import { SerpApiPhotoProvider } from "./serpapi-photo.provider";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("SerpApiPhotoProvider", () => {
  let provider: SerpApiPhotoProvider;
  let configService: ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    configService = {
      get: jest.fn().mockReturnValue("mock-serpapi-key"),
    } as any;
    provider = new SerpApiPhotoProvider(configService);
  });

  it("should enrich activity with Google Maps photos and reviews", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        place_results: {
          title: "Gran Café Tortoni",
          rating: 4.6,
          reviews: 24500,
          photos: [
            {
              thumbnail: "https://lh3.googleusercontent.com/p/thumb.jpg",
              image: "https://lh3.googleusercontent.com/p/image.jpg",
            },
          ],
          description: "Histórico café porteño con shows de tango y pastelería tradicional.",
        },
      },
    });

    const result = await provider.enrichActivity({
      name: "Café Tortoni",
      destinationName: "Buenos Aires",
    });

    expect(result.status).toBe("enriched");
    expect(result.photos.length).toBe(1);
    expect(result.photos[0].url).toContain("googleusercontent.com");
    expect(result.highlights?.length).toBeGreaterThan(0);
    expect(result.highlights?.[0]).toContain("4.6★");
  });

  it("should fail gracefully when no API key is set", async () => {
    configService = { get: jest.fn().mockReturnValue(undefined) } as any;
    delete process.env.SERPAPI_API_KEY;
    const noKeyProvider = new SerpApiPhotoProvider(configService);

    const result = await noKeyProvider.enrichActivity({ name: "Cualquier Lugar" });
    expect(result.status).toBe("failed");
    expect(result.photos.length).toBe(0);
  });
});
