import { Injectable } from '@nestjs/common';
import { GooglePlacesAcquisitionProvider } from '../providers/google-places-acquisition.provider';
import { StructuredExperienceCandidateSynthesizerService } from './structured-experience-candidate-synthesizer.service';
import { StructuredCandidateCorroborationService } from './structured-candidate-corroboration.service';
import { ExperienceAcquisitionService } from './experience-acquisition.service';
import { AnchoredPlace } from '../interfaces/preference-spec.interface';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

export interface VenueAnchorResolutionInput {
  anchors: AnchoredPlace[];
  destinationName?: string;
  destinationCountryCode?: string;
  destinationBoundary: OsmCandidate;
  destinationPointRadius?: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
}

export interface VenueAnchorResolution {
  resolvedMustIds: string[];
  resolvedSoftIds: string[];
  resolvedNames: string[];
}

/** Resolves venue anchors through Places and the shared materialization boundary. */
@Injectable()
export class VenueAnchorResolutionService {
  constructor(
    private readonly places: GooglePlacesAcquisitionProvider,
    private readonly synthesizer: StructuredExperienceCandidateSynthesizerService,
    private readonly corroborator: StructuredCandidateCorroborationService,
    private readonly acquisition: ExperienceAcquisitionService,
  ) {}

  async resolve(
    input: VenueAnchorResolutionInput,
  ): Promise<VenueAnchorResolution> {
    const result: VenueAnchorResolution = {
      resolvedMustIds: [],
      resolvedSoftIds: [],
      resolvedNames: [],
    };
    for (const anchor of input.anchors.filter(
      (item) => item.kind === 'venue',
    )) {
      const query = [anchor.rawName, input.destinationName]
        .filter(Boolean)
        .join(', ');
      const acquired = await this.places.acquire(
        { destinationName: query },
        { query, maxResultCount: 5 },
      );
      if (acquired.status !== 'success' || acquired.value.length === 0)
        continue;
      const merged = this.corroborator.corroborateAndMerge(
        this.synthesizer.synthesizeProposals(acquired.value),
      );
      const response = await this.acquisition.materializeExecution(
        {
          candidates: merged.candidates,
          observations: acquired.value,
          providerResults: {},
          evidence: acquired.value.map((observation) => ({
            key: observation.evidenceKey,
            source: observation.provider,
            title: observation.title,
            snippet: observation.description,
          })),
        },
        {
          destinationName: input.destinationName,
          destinationCountryCode: input.destinationCountryCode,
          destinationBoundary: input.destinationBoundary,
          destinationPointRadius: input.destinationPointRadius,
        },
      );
      const accepted = response.resolved
        .filter((item) => item.status === 'accepted' && item.experienceId)
        .map((item) => item.experienceId as string);
      if (accepted.length !== 1) continue; // ambiguity stays unresolved
      result.resolvedNames.push(anchor.rawName);
      if (anchor.priority === 'must') result.resolvedMustIds.push(accepted[0]);
      else result.resolvedSoftIds.push(accepted[0]);
    }
    return result;
  }
}
