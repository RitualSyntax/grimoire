# Grimoire

Recipes, a weekly meal plan and a shopping list, in the same style as Forge and Tithe. Everything is saved on your phone.

## What it does

- **Recipes**: add them from a website link, by pasting text, or by writing them yourself. Scale them to any number of servings.
- **Things you don't eat**: any ingredient on your avoid list gets flagged in red. Edit the list in settings.
- **Cook mode**: one big step at a time, the screen stays on, and you can tap any time in a step ("25 minutes") to start a timer.
- **Plan**: drop recipes into each day's breakfast, lunch, dinner or snacks.
- **Shop**: send a recipe or the whole week's plan to the list. Ingredients get merged and sorted by aisle.
- **Forge**: "Log to Forge" adds a serving straight into today's food diary.

## Importing from websites

Link import uses the same Google script as Tithe, but the script needs an update first (the new version can read recipe pages).

1. Open your script at **script.google.com**.
2. Select everything in the editor and delete it.
3. Paste in the new **Code.gs** from the Tithe repo (`mail-script/Code.gs`).
4. Put **your own token** back on line 4. It's the same one as before.
5. Save, pick **authorise** from the dropdown, click **Run** and allow the new permission. It now asks to "connect to an external service".
6. Click **Deploy → Manage deployments**, then the **pencil** icon. Set Version to **New version** and click **Deploy**.

The URL doesn't change, so Tithe keeps working. Grimoire finds the URL and token from Tithe automatically, so you don't need to type them in again.

**Sharing from Chrome:** once Grimoire is installed, open a recipe page in Chrome, tap **Share → Grimoire** and it imports the recipe.

## Forge

"Log to Forge" works when Forge is installed from **ritualsyntax.github.io/forge** in Chrome, because the two apps share the same storage. It won't reach the Forge APK version, since that keeps its data separately.
