Leave this hand-written by me right now - do not edit this if you are an LLM/agent. If you have a suggestion, suggest it and I will incorporate it if I think that's good.

# AI Flow
I had AI (fable) generate a plan, reviewed the plan, execute on the plan, review their own code and then I stepped through the main parts I thought were important (under Decisions made). Notably at the planning stage and code review stages, I used Every's compound engineering plugin's plan skill which applies agents that have different focuses (e.g., security, user experience, etc) to evaluate the code thoroughly. You can see the plan it generated in docs/plans.

# Decisions made:
Almost everything (or maybe everything here) is what I would do as this scales. There are a few dimensions to evaluate scale at: users, product surface area, developer team. Though, they tend to move together, I like to think of them separately.

The decisions I made here are things I examined more closely in the output and things I prompted the AI to change. I also tried to document decisions in-line in code but have aggregated hopefully all of them here. I also indicated where I differed from the AI / prompted it to change their solution.

The decisions I made were based on:
- not trying to over-engineer something -- focusing on what would be necessary for a solo developer product
- any explicit criteria called out in the instructions
- something that I would actually use
- making it production-ready (as a local app of course since I didn't add auth)
- Honestly, I was somewhat playing with the power of Fable also so some things I probably wouldn't have spent as much time on.

## Product decisions
- I drew inspiration from Todoist and Google Tasks
- TODO: fill this in

## Backend
- **API Versioning**: Did not version the API. In practice, for small-scale apps this adds additional work and is unnecessary. You can deploy during low-traffic time to avoid any mismatches.
- **Frontend-Backend Communication**: Although kind of unnecessary for an app this scale (developer of 1), because it was explicitly mentioned that one of the evaluation criteria was in this area and because the OpenAPI endpoint was easy to generate, I implemented zod for compile time and runtime type checking. I did not add CI/CD for ensuring the generated types were validated. TODO: something I still might do.
    - AI did this with handwritten types first and then suggested a compile-time only generator

## Frontend
- **State management**: Didn't use redux/zustand or even contexts -- unnecessary for this small app.
    - AI tried to do this with a render prop which I felt was not as appropriate
- **Style system**: Decided on a BEM (Block-Element-Modifier) style system because it's simple and works for a single developer. Likely the next step at scale is to evolve this to CSS Modules to avoid possible class name conflicts. That would have been easy enough to do since [Vite enables this](https://vite.dev/guide/features#css-modules). TODO: Maybe i'll do this still
- **Error handling**: I did not include any client-side logging in prod - I would add Sentry at scale.
    - AI did not support error handling very well - printing the output directly to the user. I added a better error view rather than and printed output to the console in a dev env.