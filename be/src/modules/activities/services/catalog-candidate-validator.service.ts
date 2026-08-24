import { Injectable } from '@nestjs/common';
import {
  CatalogCandidate,
  CatalogCandidateValidationContext,
  CatalogCandidateValidationResult,
} from '../interfaces/catalog-candidate-validation.interface';
import { CatalogAdmissionPolicy } from './catalog-admission-policy.service';
import { CatalogIdentityValidator } from './catalog-identity-validator.service';

export type {
  CatalogCandidate,
  CatalogCandidateRejectionReason,
  CatalogCandidateValidationContext,
  CatalogCandidateValidationResult,
} from '../interfaces/catalog-candidate-validation.interface';
export { SUPPORTED_CATALOG_PLACE_TYPES } from './catalog-identity-validator.service';

@Injectable()
export class CatalogCandidateValidatorService {
  private readonly identityValidator = new CatalogIdentityValidator();
  private readonly admissionPolicy = new CatalogAdmissionPolicy();

  validate(
    candidate: CatalogCandidate,
    context: CatalogCandidateValidationContext = {},
  ): CatalogCandidateValidationResult {
    const identity = this.identityValidator.validate(candidate, context);
    const admission = this.admissionPolicy.evaluate(candidate, context);
    const rejectionReasons = [
      ...new Set([...identity.rejectionReasons, ...admission.rejectionReasons]),
    ];
    return {
      accepted: identity.accepted && admission.accepted,
      identityAccepted: identity.accepted,
      admissionAccepted: admission.accepted,
      admissionEvidence: admission.evidence,
      normalizedName: identity.normalizedName,
      rejectionReasons,
    };
  }
}
