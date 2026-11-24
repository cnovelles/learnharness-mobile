# Draft: a request to Amos Blomqvist for an App Store permission

Status: DRAFT. Not sent. The user reads, changes and sends it. Issue 23, risk R1 and decision D1.

This is not legal advice. Before you send it:

1. Fill in the parts in square brackets.
2. Send it from your own account (for example a GitHub discussion, an issue, or the contact on the author's page).
3. Keep the answer in writing. Add a link to it in issue 23.

---

Subject: Permission to distribute LearnHarness code in an iPhone app on the App Store

Hello Amos,

My name is [your name]. I maintain OrbiTutor, a fork of LearnHarness with an iPhone app. The Mac app is the fork `cnovelles/learnharness` (renamed to OrbiTutor). The iPhone app is `cnovelles/learnharness-mobile`. Both are public and AGPL-3.0-only. Your copyright notices and the license stay in both repos.

The iPhone app pairs with the Mac app and runs the lessons from it. It uses some of your shared TypeScript code from `src/core` and the session model, without changes where possible.

I want to publish the iPhone app on the Apple App Store, free of charge. Many people think that the App Store terms add restrictions that the AGPL does not permit (for example the limits on how many devices can install a copy). For this reason, I ask for your written permission before I upload a build.

The request:

- You give an additional permission under section 7 of the AGPL-3.0. It lets me (and others) distribute the LearnHarness code in the OrbiTutor iPhone app through the Apple App Store and TestFlight, under Apple's terms.
- All other terms of the AGPL stay the same. The full source stays public under the AGPL, with your copyright notices and a link to your project.
- The permission is only for the App Store and TestFlight. It does not change the license of your repository.

A possible text for the permission (please change it as you like):

> Additional permission under GNU AGPL version 3 section 7: As a special exception, the copyright holder of LearnHarness gives you permission to distribute this program, or a work based on it, through the Apple App Store and Apple TestFlight, under the terms of those services, even where those terms add restrictions that the GNU AGPL does not permit. The source code of each version distributed this way must be available to everyone under the GNU AGPL version 3, without this permission's restrictions on recipients.

If you prefer to say no, or to give a narrower permission, that is fine. I will not publish the app on the App Store without your answer.

Thank you for LearnHarness.

[your name]
[the link to the OrbiTutor repository or website]
