# @wren/channel-linkedin: interface

Exports: 5. Files: 2.

## packages/channel-linkedin/src/content.ts

- **linkedinContent** (function) `(sites: SiteClient, o: LinkedInContentOptions = {}): ContentChannel`
- **PostAnalytics** (interface) `interface PostAnalytics { urn: string; url?: string; impressions: number | null; reached: number | null; reactions: number | null; comments: number | null; reposts: number | null; saves: number | null; sends: number | null; profileViewers: number | null; followersGained: number | null; videoViews?: number | null; watchSecs?: number | null; avgWatchSecs?: number | null; }`

## packages/channel-linkedin/src/outreach.ts

- **connectedOn** (function) `(text: string | undefined): Date | null`
- **parseFindQuery** (function) `(query: string): { company: string | null; words: string }`
- **linkedinOutreach** (function) `(sites: SiteClient, o: LinkedInOutreachOptions): OutreachChannel`
