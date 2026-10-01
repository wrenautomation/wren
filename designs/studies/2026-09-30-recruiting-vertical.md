# Recruiting vertical study

2026-09-30. `wren study new recruiting-vertical --vertical "owner-led recruiting and staffing firms of 10 to 50 people in the US and Canada" --sells "automation that wins back past clients and books meetings with them"`, then `study run --llm claude-code:opus`.

- 15 searches, 26 pages read, 34 claims kept, 3 dropped. 5 offers and 3 emails, none dropped.
- The same pages on Cohere with the old gate: 5 claims kept, 20 dropped. See the design doc `designs/2026-09-30-research-and-enrichment.md`.
- The generated report is below my review, unedited. `[n]` points at its Sources list.

## Verdict

Sell it. Winning clients is the pain that is growing, and almost nobody automates it.

- Finding new clients is a named problem for 23% of firms, up from 16% [16].
- Busy months stop prospecting, and the pipeline is empty three months later [20].
- Repeat and referral work converts best, but only when someone runs it as a process [19].
- Tools automate candidates. Very few automate winning clients [28].
- Owners see new tech as a risky distraction [5] and want small-firm pricing [8]. Done for you fits both.

## Timing

Q1 is the buying window: demand rebounds after the holiday freeze [23], budgets are full [27], and multi-quarter spend gets approved [26]. Book meetings for early January. The holiday-aware send calendar (no sends on US, CA and year-end holidays) already keeps December sends off the dead days.

## Trust the sources this much

- 10 of 34 claims (17 to 22, 28 to 31) come from Execue, a vendor selling the same thing. Read them as a competitor's marketing: useful for their pitch and prices, weak as fact.
- 5 claims (23 to 27) come from Signature Back Office, a vendor that sells Q1 budget spend.
- 3 claims (32 to 34) come from US Tech Automations, also a vendor.
- Level (9 to 12, 15), StaffingHub (1, 16), Bullhorn (2, 6) and Kaezn (3 to 5) are the stronger sources.
- Gaps: no claim on client churn or sales cycle, nothing Canada-specific. A narrower follow-up study should target those.

## What to use

- **Offer**: "90 Day Placement Check In" (draft offer 2) is our current reactivation shape: setup, then pay per meeting booked. It rests on [18] and [19].
- **Email angle**: the boom-bust pipeline [20], plus "tools do candidates, not clients" [28].
- **Pre-handled objection**: "one more tool nobody opens by month two" [30]. Answer it with done for you, not with ATS write-back: we don't write to their ATS today.
- **Drop**: draft email 3 says owners "often tell us" something. We have no clients, so that line is made up. The draft prompt now forbids it.

## Final email

My rewrite under the copy rules. Every fact cites a claim. No prices.

> **subject:** after a busy quarter
>
> Hi {first},
>
> You get a pile of pitches every week, so I'll keep this to one problem.
>
> When your recruiters are busy placing, nobody prospects, and three months later the client pipeline is empty again [20].
>
> The usual fix is cold outreach once things go quiet. But cold lists cost $2,500 or more per client won [18], and most recruiting tools automate candidates, not clients [28].
>
> Your cheapest new business is clients you've already placed for. That only works if someone checks in 90 days after each placement and asks outright [19]. Nobody has time for that in a busy month.
>
> That's what Wren does. We reach back out to your past clients and book the meetings. Your team doesn't learn a new tool [5].
>
> I'm William, a software engineering student at Waterloo. I built the system that found your firm.
>
> If it's worth a look, reply with two times that work and I'll book it.
>
> Thanks for reading this far.

---

## Report: Should we sell automation that wins back past clients and books meetings with them to owner-led recruiting and staffing firms of 10 to 50 people in the US and Canada, and how?

Study `recruiting-vertical` for recruiting. 15 searches, 26 pages read (3 unreadable), 34 claims kept, 3 dropped by the quote check.

### What problems cost owner-led recruiting and staffing firms of 10 to 50 people in the US and Canada the most money or growth right now, in the owners' own words?

- StaffingHub's 2026 State of Staffing report found that growing agencies scored 4.56 on a seven-point operational maturity scale versus 3.56 for shrinking ones, a gap built from practices like weekly KPI reviews, documented SOPs, and structured intake. [1]
- Bullhorn's 2026 industry trends report says optimism has dropped: 45% of staffing firms expect the economy to improve in 2026, down from 73% the year before. [2]
- Kaezn's study of recruitment SMEs says talent shortages hurt agencies twice: they limit how well agencies can serve clients, and they make it harder to grow and keep their own recruiting teams. [3]
- Kaezn reports that many recruitment firms still run on a patchwork of spreadsheets, legacy CRMs, and email-based processes, which burdens consultants and holds back growth. [4]
- Kaezn finds that agency owners focused on immediate delivery and billing targets often see new technology as a risky distraction, so they delay adopting it. [5]
- Bullhorn's 2026 report says staffing firms struggle to adopt AI because of data quality and security problems, and 20% say they lack a clear implementation plan. [6]
- Recruitment founders and CEOs at a UK Ryecroft Glenton roundtable heard that growth stalls when everything depends on the founders, and that founders often wait too long to delegate. [7]
- Small agency owners on Reddit are cost-sensitive about software; they look for tools priced for a small operation because major ATS platforms were built and priced for much larger firms. [8]

### Benchmarks for owner-led recruiting and staffing firms of 10 to 50 people in the US and Canada: revenue per employee, fees, margins, client churn, sales cycle.

- Level, a CFO firm, benchmarks staffing agency revenue per recruiter at $200K to $500K a year. [9]
- Level's staffing benchmarks put annual gross profit per producer at under $200K for laggards, about $300K for the middle, and over $400K for top firms. [10]
- Level says IT staffing earns 30 to 45% gross margins, while light industrial staffing sits at 20 to 28%. [11]
- Level says staffing net margins run 5 to 8%, so factoring fees can eat 30 to 50% of an agency's profit. [12]
- Cowen Partners, as cited by Pepper Effect, says retained executive search fees typically run 30 to 35% of the hire's first-year salary. [13]
- Pepper Effect says contingency search fees run around 20 to 30%, and a single retained C-suite search can be worth tens to hundreds of thousands of dollars. [14]
- Level's staffing benchmarks, citing ClearlyRated, say the industry's client Net Promoter Score was 45 in 2024, with top firms above 60. [15]

### How do owner-led recruiting and staffing firms of 10 to 50 people in the US and Canada win new clients today, and what does winning one cost them?

- Staffing Hub's 2025 State of Staffing survey found that 23% of staffing firms named finding new clients as a difficulty, up from 16% in 2024, and 16% named getting job orders, up from 12%. [16]
- Execue's 2026 guide on recruitment lead generation puts the average cost of winning an agency client at around $497. It says about 1 in 5 qualified leads become clients, and the target cost per lead is near $100. [17]
- Execue says the cost of winning a client varies by channel. Outbound to cold lists often costs $2,500 or more per client, outbound based on signals such as funding rounds costs $800-1,200, and referrals cost almost nothing in cash but need steady effort. [18]
- Execue says referrals are still the channel that converts best for recruitment agencies. This only holds when they are run as a process, with quarterly check-ins, follow-ups 90 days after a placement, and explicit asks. [19]
- Execue says agencies fall into a boom-bust cycle. Placements keep recruiters busy, busy periods stop prospecting, and about three months later the client pipeline is empty again. [20]
- Execue reports that a recruiter spends 8-12 hours a week on manual business development. [21]
- Execue says outreach to win clients works best as 4-7 touches across email, LinkedIn, and phone. It says this gets 287% more responses than one channel alone, and that 82% of replies come from follow-ups. [22]

### When in the year do owner-led recruiting and staffing firms of 10 to 50 people in the US and Canada hire, buy and set budgets?

- Signature Back Office, a staffing back-office vendor, says client hiring picks up after holiday freezes and staffing demand rebounds in the first quarter. [23]
- Signature Back Office, a staffing back-office vendor, says staffing demand peaks in the second quarter, and by then many firms' budgets are already stretched thin. [24]
- Signature Back Office, a staffing back-office vendor, says staffing firms start the year in Q1 with fresh growth plans and budgets they then spend on infrastructure. [25]
- Signature Back Office, a staffing back-office vendor, says multi-quarter investments at staffing firms get approved at the start of the fiscal year, when leadership focuses on annual goals. [26]
- Signature Back Office, a staffing back-office vendor, says departments have full, unspent budgets at the start of the fiscal year rather than leftovers from the fourth quarter. [27]

### Who already sells automation that wins back past clients and books meetings with them to owner-led recruiting and staffing firms of 10 to 50 people in the US and Canada, how is it priced, and what do buyers complain about?

- Execue, a vendor of agency automation, says almost every recruiting automation tool automates finding candidates and very few automate winning clients. [28]
- Execue's pricing review puts orchestration and agent platforms that cover both candidate and client work at $699 to $1,399 or more per month, and names itself in that category. [29]
- According to Execue, agency buyers commonly complain that a tool looks great in the demo but nobody uses it by month two, because it does not write results back to the ATS. [30]
- Execue says about 60% of agency buyers rank automatic ATS updates among their most important features. [31]
- US Tech Automations estimates that a 10-recruiter firm usually spends $42,000 to $145,000 on recruiting automation in the first year once integration, implementation and training are counted. [32]
- US Tech Automations lists boutique-tier recruiting tools such as Manatal and Recruiterflow Starter at $0 to $199 per recruiter per month. [33]
- US Tech Automations says it regularly sees staffing firms overpaying for enterprise ATS suites and using only 30% of them. [34]

### Draft: offers

#### Refill Before The Dip

For: owners of recruiting and staffing firms of 10 to 50 people whose recruiters are buried in placements and have stopped prospecting.
Promise: past clients keep hearing from you during busy stretches, so the client pipeline is not empty about three months later.
How: we run steady outreach to your past clients in the background, booking meetings for the owner or account leads while recruiters stay on delivery.
Risk: it runs without pulling recruiters off billing work, and you can stop any month.
Price shape: flat monthly fee.

Cites [5] [20]

#### 90 Day Placement Check In

For: owner-led firms that make placements but never go back to ask for the next job order or a referral.
Promise: every placement turns into a planned check in 90 days later, a quarterly touch, and an explicit ask for more work or a referral.
How: we set up and run the referral process automatically, with check ins, follow ups, and asks timed from each placement date.
Risk: you pay only when a meeting with a past client actually gets booked.
Price shape: per meeting booked.

Cites [18] [19]

#### Multi Channel Win Back

For: firms that send past clients one email, hear nothing, and give up.
Promise: each past client gets 4 to 7 touches across email, LinkedIn, and phone, the pattern one study found draws 287% more responses than a single channel, with 82% of replies coming from follow ups.
How: we build and run the sequence and log every touch and reply back into your ATS.
Risk: nothing lives in a side tool your team forgets by month two, because results are written straight into the ATS you already use.
Price shape: setup fee plus usage.

Cites [22] [30] [31]

#### First Quarter Rebound Campaign

For: owners planning the year at the start of their fiscal year, when budgets are full and client hiring picks up after holiday freezes.
Promise: meetings booked with past clients in the first quarter, timed to catch demand as it rebounds and before the second quarter peak.
How: we run one fixed reactivation campaign to your past client list early in the year.
Risk: a single campaign with a clear end date, approved once out of fresh annual budget, with no ongoing commitment.
Price shape: flat fee per campaign.

Cites [23] [24] [25] [26] [27]

#### Done For You Starter

For: small firms running on spreadsheets, an old CRM, and email, where the owner still does most of the business development.
Promise: take much of the 8 to 12 hours a week a recruiter spends on manual business development off their plate.
How: we connect to the tools you already have and run past client outreach for you, so nothing depends on the founder remembering to follow up.
Risk: no new ATS, no big rollout, no team training, and none of the large first year integration costs of enterprise automation.
Price shape: flat monthly fee sized for a small operation.

Cites [4] [7] [8] [21] [32]

### Draft: emails

#### your pipeline three months from now

Hi,

Quick question about what happens after a good month of placements.

I'm writing because you run a recruiting firm where the owner still drives new business, and that usually means the client pipeline rises and falls with how busy you are.

That's the boom and bust cycle most agencies know well. Placements keep your recruiters busy, busy periods stop prospecting, and about three months later the pipeline is empty again.

The usual fix is to push hard on cold outreach once things go quiet. The trouble is that winning a client from a cold list often costs $2,500 or more, and you're starting from zero every time.

What we do is keep the work going in the busy months. We reach back out to clients you've already placed for and book meetings with the ones ready to hire again, so new business doesn't stop when your team gets busy.

I know new tech can feel like a risky distraction when you're focused on billing this month. That's exactly why this runs in the background instead of asking your recruiters to take on one more thing.

[who I am]

If it's worth a talk, reply with a few times that work and I'll book it.

Thanks for reading this far.

Cites [5] [18] [20]

#### clients you placed for last spring

Hi,

When did you last hear from the clients you placed for six months ago?

I'm reaching out because firms your size usually have a list of happy past clients who simply went quiet, and that list is often the easiest new business you have.

This is the problem of past clients slipping away. Referrals and repeat work convert better than any other channel for recruiting agencies, but only when they're run as a process: quarterly check ins, a follow up 90 days after a placement, and asking outright.

The usual fix is a reminder in a spreadsheet or an old CRM. Those reminders get skipped the moment a hot search comes in, and nobody notices until the work dries up.

We set up automation that wins back past clients and books meetings with them, so those check ins and follow ups actually happen.

You might be thinking this is one more system built and priced for a firm ten times your size. It isn't. It's meant for a small team that wants the follow up done without buying an enterprise suite.

[who I am]

If you'd like to see how it would work for your firm, reply with a few times that work and I'll book it.

Thanks for reading this far.

Cites [4] [8] [19]

#### 8 to 12 hours a week on bd

Hi,

How much of your recruiters' week goes to chasing new clients by hand?

I'm writing because owners of small recruiting firms often tell us that business development eats time their best people should spend filling roles.

That's the hidden cost of manual business development. One estimate puts it at 8 to 12 hours a week for each recruiter, spent on emails, follow ups and tracking who said what.

The usual fix is a new recruiting tool. But almost every one of them automates finding candidates, and very few automate winning clients, so that time doesn't come back.

We focus on the client side. We reach back out to past clients and book meetings with the ones who are ready to talk, so your recruiters walk into conversations instead of chasing them.

The fair worry is the tool that looks great in the demo and nobody uses by month two because it doesn't update your ATS. We know that's the complaint, so keeping your records current is part of the job, not an afterthought.

[who I am]

If that sounds useful, reply with a few times that work and I'll book it.

Thanks for reading this far.

Cites [21] [28] [30]

### Sources

1. The 2026 State of Staffing Benchmarking Report Is Now Live, <https://staffinghub.com/state-of-staffing/the-2026-state-of-staffing-report-is-now-live>: "Growth agencies scored 4.56 on a seven-point operational maturity scale. Contracting agencies scored 3.56. That one-point gap, spread across seven specific practices like weekly KPI reviews, documented SOPs, and structured intake"
2. 2026 Recruitment Industry Trends Report | Bullhorn, <https://www.bullhorn.com/grid/2026-industry-trends/report>: "45% of firms expect the economy to improve in 2026 (compared to 73% last year), so optimism has dampened"
3. Recruitment at a Crossroads: What SME Agencies Must Tackle to Stay Competitive, <https://www.kaezn.com/insight/recruitment-sme-growth-challenges-study>: "this challenge is twofold — affecting both their ability to serve clients and their capacity to grow and retain their teams."
4. Recruitment at a Crossroads: What SME Agencies Must Tackle to Stay Competitive, <https://www.kaezn.com/insight/recruitment-sme-growth-challenges-study>: "Many firms still rely on a patchwork of spreadsheets, legacy CRMs, and email-based processes—none of which provide the agility or insight modern recruitment operations require."
5. Recruitment at a Crossroads: What SME Agencies Must Tackle to Stay Competitive, <https://www.kaezn.com/insight/recruitment-sme-growth-challenges-study>: "For agency owners focused on immediate delivery and billing targets, technology implementation can feel like a risky distraction rather than a strategic investment."
6. 2026 Recruitment Industry Trends Report | Bullhorn, <https://www.bullhorn.com/grid/2026-industry-trends/report>: "Data quality and security are challenges many firms have not quite been able to overcome. And 20% say they lack a clear implementation plan."
7. Breaking barriers to growth: key insights for recruitment sector founders & CEOs, <https://ryecroftglenton.com/2025/10/21/breaking-barriers-to-growth-key-insights-for-recruitment-sector-founders-ceos>: "Growth stalls when everything depends on the founders."
8. Best ATS for staffing agencies, according to Reddit (2026) | Happlicant, <https://www.happlicant.com/blog/best-ats-for-staffing-agencies-according-to-reddit>: "the person is specifically looking for something affordable, not the cheapest option available, but something priced sensibly for a small operation rather than an enterprise one."
9. <https://www.levelcfo.com/downloads/level-staffing-benchmarks-2026.pdf>: "$200K–$500K  Revenue per recruiter — the productivity benchmark"
10. The Level Index for Staffing Agencies | Level, <https://levelcfo.com/benchmarks/staffing>: "| GP per Producer (annual) | < $200K | $300K | > $400K |"
11. <https://www.levelcfo.com/downloads/level-staffing-benchmarks-2026.pdf>: "IT staffing commands 30–45% gross margins thanks to high bill rates and specialized talent. Light industrial sits at 20–28% — highest volume, thinnest margin per placement."
12. <https://www.levelcfo.com/downloads/level-staffing-benchmarks-2026.pdf>: "If net margins are 5–8%, that's 30–50% of profit going to the factor."
13. The Recruiter's Pipeline Leak Nobody Is Measuring, <https://peppereffect.com/blog/recruitment-firm-profitability>: "retained executive search fees typically run 30 to 35% of first-year salary"
14. The Recruiter's Pipeline Leak Nobody Is Measuring, <https://peppereffect.com/blog/recruitment-firm-profitability>: "with contingency around 20 to 30%. A single retained C-suite mandate can be worth tens of thousands to hundreds of thousands in fees."
15. The Level Index for Staffing Agencies | Level, <https://levelcfo.com/benchmarks/staffing>: "| Client NPS (ClearlyRated) | < 25 | 45 | > 60 | Industry NPS hit 45 in 2024 |"
16. Staffing Hub - 2025 State of Staffing Report - Full, <https://staffinghub.com/wp-content/uploads/%5Fpda/2025/04/Staffing-Hub-2025-State-of-Staffing-Report-Full-Temp.pdf>: "Many businesses reported difficulty finding new clients (23% , up from 16% in 2024) and job orders ( 16% , up from 12% )."
17. Recruitment Lead Generation: The Complete 2026 Guide, <https://execue.io/blog/recruitment-lead-generation>: "The benchmark economics to build against: average client acquisition cost around $497, roughly 1-in-5 qualified leads converting to a client, and a target cost-per-lead near $100."
18. Recruitment Lead Generation: The Complete 2026 Guide, <https://execue.io/blog/recruitment-lead-generation>: "Cold-list outbound often runs $2,500+ per client; signal-based outbound runs $800-1,200; referrals cost close to nothing in cash but require systematic effort."
19. Recruitment Lead Generation: The Complete 2026 Guide, <https://execue.io/blog/recruitment-lead-generation>: "still the highest-converting source, but only when run as a process (quarterly check-ins, 90-day placement follow-ups, explicit asks), not an accident"
20. Recruitment Lead Generation: The Complete 2026 Guide, <https://execue.io/blog/recruitment-lead-generation>: "Placements create busy periods, busy periods pause prospecting, and three months later the pipeline is empty again."
21. The ROI of Recruitment Lead Generation Tools (2026), <https://execue.io/blog/roi-recruitment-lead-generation-tools>: "A recruiter spends 8-12 hours a week on manual BD."
22. Recruitment Lead Generation: The Complete 2026 Guide, <https://execue.io/blog/recruitment-lead-generation>: "4-7 touches across email, LinkedIn, and phone (287% more responses than single-channel; 82% of replies come from follow-ups)"
23. 2026 Staffing Budget Restart, <https://signaturebackoffice.com/2026-staffing-budget-restart>: "Staffing demand rebounds in Q1, making it the ideal time to commit to contract staffing expansion."
24. 2026 Staffing Budget Restart, <https://signaturebackoffice.com/2026-staffing-budget-restart>: "By the time demand peaks in Q2, budget is already stretched thin and operational bottlenecks prevent growth."
25. 2026 Staffing Budget Restart, <https://signaturebackoffice.com/2026-staffing-budget-restart>: "Most staffing firms enter Q1 with ambitious growth plans but burn through budget on infrastructure that takes months to build or costs that don’t scale with demand."
26. 2026 Staffing Budget Restart, <https://signaturebackoffice.com/2026-staffing-budget-restart>: "This is when multi-quarter investments get approved."
27. 2026 Staffing Budget Restart, <https://signaturebackoffice.com/2026-staffing-budget-restart>: "Departments have full budgets to deploy, not leftover scraps from Q4."
28. Recruiting Automation Software: The Buyer's Guide, <https://execue.io/blog/recruiting-automation-software>: "Almost every tool on the market automates the first motion. Very few touch the second."
29. Recruiting Automation Software: The Buyer's Guide, <https://execue.io/blog/recruiting-automation-software>: "Orchestration / agent platforms | Both | 2-3 | $699-1,399/mo+ | Execue and the agentic wave"
30. Recruiting Automation Software: The Buyer's Guide, <https://execue.io/blog/recruiting-automation-software>: "the tool looked great in the demo, produced real output — and by month two nobody opens it."
31. Recruiting Automation Software: The Buyer's Guide, <https://execue.io/blog/recruiting-automation-software>: "Around 60% of agency buyers rate automatic ATS updates among their most important features"
32. Recruiting Automation Pricing: What ATS Tools Cost [Guide], <https://ustechautomations.com/resources/blog/recruiting-workflow-automation-pricing-guide-2026>: "Total first-year cost for a 10-recruiter firm typically lands between $42,000 and $145,000"
33. Recruiting Automation Pricing: What ATS Tools Cost [Guide], <https://ustechautomations.com/resources/blog/recruiting-workflow-automation-pricing-guide-2026>: "1: Boutique | $0–$199 | $0–$24,000 | 1–10 | Manatal, Recruiterflow Starter"
34. Recruiting Automation Pricing: What ATS Tools Cost [Guide], <https://ustechautomations.com/resources/blog/recruiting-workflow-automation-pricing-guide-2026>: "overpay for enterprise ATS suites they only use 30% of"
