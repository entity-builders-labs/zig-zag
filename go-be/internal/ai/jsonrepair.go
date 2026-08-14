package ai

import (
	"regexp"
	"strings"
)

var (
	fencedJSONOpen  = regexp.MustCompile("(?i)^```json\\s*")
	fencedOpen      = regexp.MustCompile("^```\\s*")
	fencedClose     = regexp.MustCompile("\\s*```$")
	leadingPreamble = regexp.MustCompile(`(?i)^here'?s? (the|your|a) (json|response):\s*`)
	leadingJSONTag  = regexp.MustCompile(`(?i)^json:\s*`)
	trailingSignoff = regexp.MustCompile(`(?i)\s*this is (the|your|a) (json|response)\.?\s*$`)
	trailingComma   = regexp.MustCompile(`,(\s*[}\]])`)
	blockComment    = regexp.MustCompile(`(?s)/\*.*?\*/`)
	lineComment     = regexp.MustCompile(`(?m)//.*$`)
)

// ExtractAndCleanJSON ports extractAndCleanJson
// (be/src/modules/tours/utils/json-parser.util.ts): strips markdown code
// fences, extracts the first balanced {...} object (string/escape aware),
// and trims common LLM preambles/signoffs around it.
func ExtractAndCleanJSON(text string) string {
	cleaned := strings.TrimSpace(text)

	cleaned = fencedJSONOpen.ReplaceAllString(cleaned, "")
	cleaned = fencedOpen.ReplaceAllString(cleaned, "")
	cleaned = fencedClose.ReplaceAllString(cleaned, "")

	if obj, ok := extractBalancedJSONObject(cleaned); ok {
		cleaned = obj
	} else if start := strings.Index(cleaned, "{"); start != -1 {
		if end := strings.LastIndex(cleaned, "}"); end != -1 && end > start {
			cleaned = cleaned[start : end+1]
		}
	}

	cleaned = strings.TrimSpace(cleaned)
	cleaned = leadingPreamble.ReplaceAllString(cleaned, "")
	cleaned = leadingJSONTag.ReplaceAllString(cleaned, "")
	cleaned = trailingSignoff.ReplaceAllString(cleaned, "")

	return cleaned
}

// extractBalancedJSONObject finds the first "{" and returns the text up to
// its matching "}", tracking string/escape state so braces inside string
// values don't throw off the depth count.
func extractBalancedJSONObject(text string) (string, bool) {
	start := strings.Index(text, "{")
	if start == -1 {
		return "", false
	}

	depth := 0
	inString := false
	escapeNext := false

	for i := start; i < len(text); i++ {
		c := text[i]

		if escapeNext {
			escapeNext = false
			continue
		}
		if c == '\\' {
			escapeNext = true
			continue
		}
		if c == '"' {
			inString = !inString
			continue
		}
		if !inString {
			switch c {
			case '{':
				depth++
			case '}':
				depth--
				if depth == 0 {
					return text[start : i+1], true
				}
			}
		}
	}
	return "", false
}

// RepairJSON ports repairJson: strips trailing commas and comments (neither
// of which is valid JSON, but LLMs produce them anyway), and escapes raw
// newlines/CR/tabs found inside string values.
func RepairJSON(jsonString string) string {
	repaired := trailingComma.ReplaceAllString(jsonString, "$1")
	repaired = blockComment.ReplaceAllString(repaired, "")
	repaired = lineComment.ReplaceAllString(repaired, "")
	return escapeControlCharsInStrings(repaired)
}

func escapeControlCharsInStrings(s string) string {
	var b strings.Builder
	b.Grow(len(s))

	inString := false
	escapeNext := false

	for i := 0; i < len(s); i++ {
		c := s[i]

		if escapeNext {
			b.WriteByte(c)
			escapeNext = false
			continue
		}
		if c == '\\' {
			b.WriteByte(c)
			escapeNext = true
			continue
		}
		if c == '"' {
			inString = !inString
			b.WriteByte(c)
			continue
		}

		if inString {
			switch c {
			case '\n':
				b.WriteString(`\n`)
			case '\r':
				b.WriteString(`\r`)
			case '\t':
				b.WriteString(`\t`)
			default:
				b.WriteByte(c)
			}
		} else {
			b.WriteByte(c)
		}
	}

	return b.String()
}
