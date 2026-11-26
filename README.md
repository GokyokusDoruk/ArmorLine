# ArmorLine

Telefon öncelikli, tarayıcıda da oynanan 3D tank PvP oyunu. Vite + TypeScript + Three.js.

## Oynanış
- 5'e 5 takım savaşı, 5 dakika. Rakip takımı yok et ya da süre bitince daha fazla canla kal.
- 5 ülke (SSCB, Almanya, ABD, İngiltere, Fransa) × 4 sınıf (Tank, Mobil, Sniper, Artillery) = 20 tank.
- 8 nadirlik: Poor, Common, Uncommon, Rare, Epic, Legendary, Mythic, Divine. Düşme olasılıkları 15/12/9/6/5/4/3/2 ağırlıklarının %100'e oranlanmış hâli.
- Zırh delme, eğimli zırh, sektirme, görüş (spot) sistemi.
- 6 parça slotu: Main Gun, Turret, Armor, Engine, Palet, Optic. Parçalar sadece kendi ülkesinin tanklarına takılır. Optic, nişan alınan yerin delinip delinmeyeceğini renkle (ve nadirliğe göre yüzde ve hasar tahminiyle) gösterir.
- Ödüller: hasar kadar para (galibiyette 2 katı); galibiyette %10 tank / %15 parça, mağlubiyette %5 tank / %10 parça şansı. Aynı tank tekrar düşerse paraya çevrilir.
- Mağaza her 5 dakikada bir yenilenir ve 5 parça satar. Nadir parçalar hem daha pahalı hem daha seyrek gelir.
- İlerleme tarayıcıda (`localStorage`) saklanır.

Denge sayıları: `src/data/tanks.ts` (ülke ve sınıf statları), `src/data/rarity.ts` (nadirlik çarpanları ve fiyatlar), `src/data/parts.ts` (parça bonusları), `src/meta/rewards.ts` (ödül oranları).

## Kontroller
- Telefon: sol yarıda sürükle → sür; sağ yarıda sürükle → nişan; ATEŞ, 🔭 zoom, 🎯 topçu görünümü.
- Bilgisayar: WASD sür, fare nişan (ekrana tıkla), sol tık / Space ateş, sağ tık / Shift zoom, E topçu görünümü.

## Geliştirme
```powershell
npm install
npm run dev
```
```powershell
npm test
```
```powershell
npm run build
```
Çıktı `dist/` klasörüne yazılır (statik dosyalar, göreli yollar).

## Yayın (Cloudflare Pages)
- Derleme komutu: `npm run build`
- Çıktı klasörü: `dist`
- Alan adı: `armorline.dorukplays.com`
