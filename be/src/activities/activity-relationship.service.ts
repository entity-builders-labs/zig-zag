import { Injectable } from '@nestjs/common';
import { Activity, RelationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LangChainService } from '../shared/ai/langchain.service';

/**
 * Interface for geographic coordinates
 */
interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Interface for activity relationship analysis results
 */
export interface ActivityRelationshipAnalysis {
  sourceActivityId: string;
  targetActivityId: string;
  compatibilityScore: number;
  timeCompatibilityScore: number;
  distanceScore: number;
  varietyScore: number;
  relationType: RelationType;
  reasoning: string;
  timeGapRecommended?: number;
  analysis: any;
}

/**
 * Service responsible for analyzing relationships between activities
 * Provides scoring and compatibility analysis for activity pairs
 */
@Injectable()
export class ActivityRelationshipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly langChainService: LangChainService,
  ) {}
  // Constants for calculations
  private readonly MAX_RECOMMENDED_DISTANCE = 5000; // 5km
  private readonly MIN_TIME_GAP = 15; // 15 minutes
  private readonly OPTIMAL_VARIETY_THRESHOLD = 0.7;

  /**
   * Analyzes the relationship between two activities and generates comprehensive scoring
   * @param sourceActivity The first activity to analyze
   * @returns Detailed analysis of the relationship between the activities
   */
  public async analyzeRelationship(sourceActivityId: string): Promise<any> {
    const sourceActivity = await this.prisma.activity.findUnique({
      where: {
        id: parseInt(sourceActivityId),
      },
    });

    // Get all activities within 1 degree of the source activity

    /*     const activityRelationships: ActivityRelationshipAnalysis[] = [];

    for (const targetActivity of nearbyActivities) {
      // Calculate core scores
      const distanceScore = this.calculateDistanceScore(
        sourceActivity,
        targetActivity,
      );
      const timeScore = this.calculateTimeCompatibilityScore(
        sourceActivity,
        targetActivity,
      );
      const varietyScore = this.calculateVarietyScore(
        sourceActivity,
        targetActivity,
      );

      // Determine relationship characteristics
      const relationType = this.determineRelationType(
        sourceActivity,
        targetActivity,
        { distanceScore, timeScore, varietyScore },
      );

      // Calculate overall compatibility
      const compatibilityScore = this.calculateOverallCompatibility(
        distanceScore,
        timeScore,
        varietyScore,
      );

      // Generate explanation
      const reasoning = this.generateReasoning(sourceActivity, targetActivity, {
        distanceScore,
        timeScore,
        varietyScore,
        relationType,
      });

      const analysis = await this.langChainService.analyzeActivity(
        sourceActivity,
        distanceScore,
      );

      const activityRelationship: ActivityRelationshipAnalysis = {
        sourceActivityId: sourceActivity.id.toString(),
        targetActivityId: targetActivity.id.toString(),
        compatibilityScore,
        timeCompatibilityScore: timeScore,
        distanceScore,
        varietyScore,
        relationType,
        reasoning,
        analysis,
      };

      activityRelationships.push(activityRelationship);
    }

    return activityRelationships; */
    return this.langChainService.analyzeActivity(sourceActivity, 10);
  }

  /**
   * Calculates the distance score between two activities
   * Higher scores indicate more favorable distances
   */
  private calculateDistanceScore(source: Activity, target: Activity): number {
    const distance = this.calculateDistance(
      { latitude: source.latitude, longitude: source.longitude },
      { latitude: target.latitude, longitude: target.longitude },
    );

    // Convert distance to score (0-100)
    return Math.max(
      0,
      Math.round(100 - (distance / this.MAX_RECOMMENDED_DISTANCE) * 100),
    );
  }

  /**
   * Calculates the geographical distance between two points using the Haversine formula
   * @returns Distance in meters
   */
  private calculateDistance(coord1: Coordinates, coord2: Coordinates): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (coord1.latitude * Math.PI) / 180;
    const φ2 = (coord2.latitude * Math.PI) / 180;
    const Δφ = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
    const Δλ = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Calculates time compatibility score based on activity durations
   * Considers total duration and potential scheduling conflicts
   */
  private calculateTimeCompatibilityScore(
    source: Activity,
    target: Activity,
  ): number {
    const totalDuration = source.duration + target.duration;

    // Penalize if total duration is too long (>8 hours)
    if (totalDuration > 480) {
      return Math.max(0, Math.round(100 - ((totalDuration - 480) / 60) * 10));
    }

    return 100;
  }

  /**
   * Calculates variety score based on activity characteristics
   * Higher scores for complementary activities, lower for similar ones
   */
  private calculateVarietyScore(source: Activity, target: Activity): number {
    if (source.type === target.type) {
      return 30; // Lower score for same type activities
    }

    // Higher score for complementary types
    return 80;
  }

  /**
   * Calculates overall compatibility score using weighted individual scores
   */
  private calculateOverallCompatibility(
    distanceScore: number,
    timeScore: number,
    varietyScore: number,
  ): number {
    // Weighted average with distance having highest priority
    return Math.round(
      distanceScore * 0.4 + timeScore * 0.3 + varietyScore * 0.3,
    );
  }

  /**
   * Determines the relationship type between activities based on scores and characteristics
   */
  private determineRelationType(
    source: Activity,
    target: Activity,
    scores: { distanceScore: number; timeScore: number; varietyScore: number },
  ): RelationType {
    if (source.type === target.type) {
      return 'SIMILAR';
    }

    if (scores.distanceScore >= 70 && scores.timeScore >= 70) {
      return 'SEQUENTIAL';
    }

    return 'COMPLEMENTARY';
  }

  /**
   * Calculates recommended time gap between activities based on distance and type
   * @returns Recommended gap in minutes
   */
  private calculateRecommendedTimeGap(
    source: Activity,
    target: Activity,
  ): number {
    const distance = this.calculateDistance(
      { latitude: source.latitude, longitude: source.longitude },
      { latitude: target.latitude, longitude: target.longitude },
    );

    // Base calculation: 1km = 15 minutes + minimum gap
    return Math.max(this.MIN_TIME_GAP, Math.round(distance / 1000) * 15);
  }

  /**
   * Generates human-readable explanation for the relationship analysis
   */
  private generateReasoning(
    source: Activity,
    target: Activity,
    scores: {
      distanceScore: number;
      timeScore: number;
      varietyScore: number;
      relationType: RelationType;
    },
  ): string {
    const distance = this.calculateDistance(
      { latitude: source.latitude, longitude: source.longitude },
      { latitude: target.latitude, longitude: target.longitude },
    );

    const reasoningParts = [];

    // Add distance context
    reasoningParts.push(
      `Activities are ${Math.round(distance / 100) / 10}km apart.`,
    );

    // Add type relationship
    if (source.type === target.type) {
      reasoningParts.push('Activities are of the same type.');
    } else {
      reasoningParts.push('Activities offer different experiences.');
    }

    // Add compatibility insights
    if (scores.distanceScore >= 70) {
      reasoningParts.push('The distance between activities is convenient.');
    }

    if (scores.timeScore >= 70) {
      reasoningParts.push('The time arrangement is suitable.');
    }

    return reasoningParts.join(' ');
  }
}
