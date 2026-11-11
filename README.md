# JAZ Trading FIMC – Optimiseur de stratégies TradingView

Extension **Chrome** et **Microsoft Edge** qui optimise vos stratégies TradingView **paramètre par paramètre, indicateur par indicateur**.

1. Vous choisissez les indicateurs (sections de l'onglet *Paramètres en entrée*) et leurs paramètres.
2. Pour chaque paramètre : début, fin et pas (ex. 1 → 200, pas 1).
3. L'extension teste toutes les valeurs du 1er paramètre, garde la meilleure (profit net élevé, drawdown faible), passe au paramètre suivant, puis à l'indicateur suivant.
4. À la fin, les meilleurs réglages sont appliqués à votre stratégie.

Aucun compte, aucun serveur : l'extension travaille directement dans votre onglet TradingView, avec votre session.

## Installation (2 minutes)

1. Téléchargez **`JAZ-Optimiseur.zip`** dans la dernière [Release](../../releases/latest) et décompressez-le.
2. Ouvrez la page des extensions :
   - Chrome : `chrome://extensions`
   - Edge : `edge://extensions`
3. Activez **Mode développeur**.
4. Cliquez sur **Charger l'extension non empaquetée** et choisissez le dossier décompressé `JAZ-Optimiseur` (celui qui contient `manifest.json`).
5. Épinglez l'icône : bouton puzzle 🧩 → épingle 📌 à côté de *JAZ Trading FIMC*.

## Utilisation

1. Cliquez sur l'icône JAZ : si aucun graphique TradingView n'est ouvert, il s'ouvre automatiquement.
2. Ajoutez votre stratégie au graphique et ouvrez le panneau **Rapport de stratégie** en bas.
3. Icône JAZ → **Optimiser** à côté de votre stratégie → suivez les 3 étapes.
4. Gardez l'onglet TradingView ouvert et visible pendant l'optimisation.

## Mise à jour

Quand une nouvelle version sort, l'icône affiche **MAJ**. Téléchargez le nouveau ZIP, remplacez le dossier, puis cliquez sur ↻ (Actualiser) sur la carte de l'extension dans `chrome://extensions`.

## En cas de problème

Menu ☰ → **Options** → **Diagnostic** : le rapport est copié automatiquement, envoyez-le.
