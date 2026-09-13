import { Injectable } from '@nestjs/common';
import {
  ExperienceCandidate,
  GeoEntityHint,
} from '../interfaces/experience-discovery.interface';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
import { StructuredCandidateProposal } from '../interfaces/structured-candidate-proposal.interface';

@Injectable()
export class StructuredExperienceCandidateSynthesizerService {
  synthesizeProposals(
    observations: SourceObservation[],
  ): StructuredCandidateProposal[] {
    return observations.map((obs) => {
      const componentHints: GeoEntityHint[] = [];

      // Strictly mechanical mapping:
      // place -> venue/PLACE
      // area -> area/AREA
      // route -> route/ROUTE
      // tourism_activity, operator, editorial -> componentHints: []
      if (obs.evidenceType === 'place') {
        componentHints.push({
          key: `${obs.evidenceKey}:component`,
          name: obs.title,
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: [obs.evidenceKey],
        });
      } else if (obs.evidenceType === 'area') {
        componentHints.push({
          key: `${obs.evidenceKey}:component`,
          name: obs.title,
          role: 'area',
          expectedKind: 'AREA',
          required: true,
          evidenceKeys: [obs.evidenceKey],
        });
      } else if (obs.evidenceType === 'route') {
        componentHints.push({
          key: `${obs.evidenceKey}:component`,
          name: obs.title,
          role: 'route',
          expectedKind: 'ROUTE',
          required: true,
          evidenceKeys: [obs.evidenceKey],
        });
      }

      const candidate: ExperienceCandidate = {
        name: obs.title,
        description: obs.description,
        themes: [] as string[],
        traits: [] as string[],
        intents: [] as string[],
        componentHints,
        evidenceKeys: [obs.evidenceKey],
        shortReason: `Structured observation from ${obs.provider}: ${obs.title}`,
        orderedByEvidence: false,
        // B3 live wiring -- pure pass-through of the ALREADY-normalized,
        // typed evidence the provider adapter attached (docs/architecture/
        // engineering-principles.md §1/§3). This layer never branches on
        // `obs.provider` and never decodes `obs.metadata`.
        qualityEvidence: obs.qualityEvidence,
      };

      return {
        candidate,
        observations: [obs],
      };
    });
  }

  synthesize(observations: SourceObservation[]): ExperienceCandidate[] {
    return this.synthesizeProposals(observations).map((p) => p.candidate);
  }
}
