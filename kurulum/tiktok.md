# TikTok

Planladığın Reels videoları aynı saatte TikTok'ta da yayınlansın. Stüdyo resmi bir TikTok API'si kullanmaz: **TikTok Studio**'yu bilgisayarındaki Microsoft Edge ya da Google Chrome ile, stüdyonun kendi ayrı tarayıcı profilinde görünmez bir pencerede açar, videoyu yükler ve TikTok'un kendi planlayıcısıyla planlar. Saati gelince TikTok kendisi yayınlar; yayın anında bilgisayarın kapalı olabilir.

- Video yayın saatinden en fazla 7 gün önce yüklenir. Saate 20 dakikadan az kaldıysa video hemen paylaşılır.
- Şifren stüdyoya yazılmaz; oturum yalnızca bu bilgisayardaki ayrı tarayıcı profilinde saklanır.

## Bilmen gerekenler

- TikTok'un kullanım şartları otomatik kullanıma izin vermiyor; küçük de olsa hesabın kısıtlanma riski var.
- TikTok bir güvenlik doğrulaması (captcha) gösterirse stüdyo durur ve senden yeniden giriş yapmanı ister. Doğrulamayı her zaman kendin çöz.
- Video TikTok'ta planlandıktan sonra stüdyoda saatini ya da açıklamasını değiştirirsen TikTok'taki plan kendiliğinden değişmez; [TikTok Studio](https://www.tiktok.com/tiktokstudio/content)'dan güncellemen gerekir.

## 1. Bileşeni kur (bir kez)

TikTok için Python'daki **Playwright** paketi ve **Microsoft Edge** ya da **Google Chrome** gerekir. Windows'ta Edge zaten yüklü gelir.

**Ayarlar › TikTok** "Bir kez kurulum gerekli" diyorsa:

1. **Ayarlar › Bileşenler** içindeki **TikTok yükleme** satırında **Kur**'a bas.
2. Ya da komut istemini açıp şunu çalıştır:

   ```
   python -m pip install playwright
   ```

3. Stüdyoyu yeniden başlat ve **Ayarlar › TikTok**'ta **Tekrar kontrol et**'e bas.

## 2. TikTok'a giriş yap

1. **Ayarlar › TikTok** → **TikTok'a giriş yap**.
2. Açılan Edge (ya da Chrome) penceresinde telefon, e-posta ya da Google gibi istediğin yöntemle **kendin** giriş yap.
3. Giriş bitince pencereyi kapat. Stüdyo oturumu kendiliğinden kontrol eder ve "Bağlı" gösterir.

## 3. Ayarları seç

- **Planlanan Reels videolarını TikTok'ta da planla**: önce tek bir videoyla dene. Her içeriğin paylaşım bölümünden tek tek de açıp kapatabilirsin.
- **TikTok'ta kimler görebilsin?**: Herkes ya da Arkadaşlar. TikTok, "Sadece siz" görünürlüğüyle planlamaya izin vermiyor.
- **Bağlantıyı kontrol et** ile oturumun hâlâ açık olduğunu istediğin zaman görebilirsin.

## Sorun çıkarsa

- **"TikTok oturumu kapalı"**: Ayarlar › TikTok › **TikTok'a giriş yap** ile yeniden giriş yap; bekleyen paylaşımlar kendiliğinden tekrar denenir.
- **Bileşen kurulamadı**: Ayarlar › Bileşenler'deki hata metnini Claude'a gönder.

## Claude ile kur

**Ayarlar › TikTok** ve **Hesaplarım › TikTok** ekranındaki **Claude ile kur** düğmesi, Claude'a gönderebileceğin hazır bir metin açar.

Güvenlik kuralları (metinde Claude'a da yazılıdır):

- TikTok şifreni ve doğrulama kodlarını Claude'a yazma; girişi açılan pencerede kendin yap.
- Gizli bilgileri bir dosyaya kaydetme ya da bir komutla gönderme.
- Güvenlik doğrulamalarını, şart kabulünü ve onay düğmelerini kendin yap.
- Bir hata görürsen Claude'a yalnızca hata metnini gönder.
