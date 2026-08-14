package tours

// VerifyAndDedupeActivities ports verifyAndDedupeActivities
// (utils/activity-verification.util.ts): keeps only activities that trace
// back to a real candidate the model was offered (drops hallucinations),
// then removes repeated picks of the same place (drops duplicates). Order
// is preserved. This is the hard safety net against the AI inventing
// places — prompt instructions alone aren't reliable enough on their own.
func VerifyAndDedupeActivities(raw []AIActivity, candidateIDs map[string]bool) (verified []AIActivity, hallucinatedCount, duplicateCount int) {
	for _, act := range raw {
		if act.ActivityID != "" && candidateIDs[act.ActivityID] {
			verified = append(verified, act)
		}
	}
	hallucinatedCount = len(raw) - len(verified)

	seen := make(map[string]bool, len(verified))
	unique := make([]AIActivity, 0, len(verified))
	for _, act := range verified {
		if seen[act.ActivityID] {
			continue
		}
		seen[act.ActivityID] = true
		unique = append(unique, act)
	}
	duplicateCount = len(verified) - len(unique)

	return unique, hallucinatedCount, duplicateCount
}
