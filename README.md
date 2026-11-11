# JAZ Trading FIMC – Optimiseur de stratégies TradingView

Extension **Chrome** et **Microsoft Edge** qui optimise vos stratégies TradingView **paramètre par paramètre, indicateur par indicateur**.

1. Vous choisissez les indicateurs (sections de l'onglet *Paramètres en entrée*) et leurs paramètres.
2. Pour chaque paramètre : début, fin et pas (ex. 1 → 200, pas 1).
3. L'extension teste toutes les valeurs du 1er paramètre, garde la meilleure (profit net élevé, drawdown faible), passe au paramètre suivant, puis à l'indicateur suivant.
4. À la fin, les meilleurs réglages sont appliqués à votre stratégie.

Aucun compte, aucun serveur : l'extension travaille directement dans votre onglet TradingView, avec votre session.

## Installation (2 minutes, une seule fois)

1. Téléchargez **`JAZ-Optimiseur.zip`** dans la dernière [Release](../../releases/latest) et décompressez-le **dans un dossier définitif** (par ex. `Documents\JAZ-Optimiseur`) : ne le supprimez plus ensuite.
2. Dans ce dossier, double-cliquez sur **`Activer-mises-a-jour-auto.cmd`** : votre PC vérifiera GitHub toutes les heures et installera seul les nouvelles versions.
3. Ouvrez la page des extensions :
   - Chrome : `chrome://extensions`
   - Edge : `edge://extensions`
4. Activez **Mode développeur**.
5. Cliquez sur **Charger l'extension non empaquetée** et choisissez ce même dossier `JAZ-Optimiseur` (celui qui contient `manifest.json`).
6. Épinglez l'icône : bouton puzzle 🧩 → épingle 📌 à côté de *JAZ Trading FIMC*.

## Utilisation

1. Cliquez sur l'icône JAZ : si aucun graphique TradingView n'est ouvert, il s'ouvre automatiquement.
2. Ajoutez votre stratégie au graphique et ouvrez le panneau **Rapport de stratégie** en bas.
3. Icône JAZ → **Optimiser** à côté de votre stratégie → suivez les 3 étapes.
4. Gardez l'onglet TradingView ouvert et visible pendant l'optimisation.

## Mise à jour

**Automatique** : si vous avez lancé `Activer-mises-a-jour-auto.cmd`, chaque nouvelle version publiée ici est téléchargée par votre PC (vérification toutes les heures) et l'extension se recharge seule (jamais pendant une optimisation). Une notification « JAZ Optimiseur mis à jour » s'affiche.

Pour désactiver : `powershell -ExecutionPolicy Bypass -File jaz-update.ps1 -Uninstall` dans le dossier de l'extension.

## En cas de problème

Menu ☰ → **Options** → **Diagnostic** : le rapport est copié automatiquement, envoyez-le.
