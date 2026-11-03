import re

import core

GUIDE_URL = "https://github.com/BerTaDev/SosyalStudyo/blob/main/kurulum/{}.md"
PATH_RE = re.compile(r"^/api/claude-setup/([a-z]+)$")

HEAD = ("Sosyal Stüdyo'da {what} adım adım kurmama yardım et. Teknik biri değilim: her seferinde tek adım anlat, "
        "\"tamam\" deyince sonrakine geç, İngilizce ekranlardaki düğme adlarını aynen yaz.")

RULES = """Kurallar:
- Şifre, API anahtarı, token ya da client secret isteme; sohbete yazmamı, dosyaya kaydetmemi ya da komutla göndermemi önerme. Onları stüdyodaki kendi kutularına ben yapıştırırım.
- Ad, adres gibi kişisel bilgileri benim yerime doldurma, dosya yükleme; Submit, şart kabulü ya da izin onayına benim yerime basma.
- Hata çıkarsa sana yalnızca hata metnini, anahtar olmadan yazarım.
- Ücretsiz planları tercih et."""

TOPICS = {
    "instagram": ("Instagram bağlantısı", "Instagram bağlantısını", """Ne kuruyoruz: Stüdyo paylaşım, yorum, mesaj ve istatistikler için Instagram API'sini kullanıyor. Kendi Meta geliştirici uygulamamla süresi dolmayan bir erişim anahtarı (system user token) oluşturacağım.
Adımlar: 1) Instagram hesabını Profesyonel (Business ya da Creator) yapmak. 2) business.facebook.com'da işletme portföyüne Instagram hesabını eklemek. 3) developers.facebook.com/apps'te Business türü uygulama açıp Instagram ürününü "API setup with Facebook login" ile eklemek. 4) Facebook Login for Business > Configurations: token türü System user, süre Never; izinler instagram_basic, instagram_content_publish, instagram_manage_comments, instagram_manage_messages, instagram_manage_insights. 5) Business settings > System users: yönetici sistem kullanıcısına uygulamayı ve Instagram hesabını atayıp bu yapılandırmayla Generate token. 6) Anahtarı stüdyoda Ayarlar > Instagram > Erişim anahtarı kutusuna kendim yapıştırıp Bağlan'a basacağım."""),
    "youtube": ("YouTube Shorts", "YouTube Shorts paylaşımını", """Ne kuruyoruz: Planlanan Reels videoları aynı saatte YouTube kanalımda Shorts olarak da yayınlansın. Kendi Google hesabımda ücretsiz bir Google Cloud projesi açıp YouTube Data API v3'ü etkinleştireceğim ve Desktop app türünde OAuth istemcisi oluşturacağım; kart gerekmiyor.
Adımlar: 1) console.cloud.google.com/projectcreate ile proje açmak. 2) YouTube Data API v3 sayfasında Enable. 3) Google Auth Platform > Get started: App name, User support email, Audience: External, iletişim e-postası. 4) Audience > Test users > Add users: kanalın bağlı olduğu Google hesabı (Testing modunda bağlantı 7 günde bir yenilenir; kalıcı olması için Publish app). 5) Clients > Create client > Desktop app; Client ID ve Client secret'ı kopyalamak. 6) Stüdyoda Ayarlar > YouTube'da ikisini kutulara kendim yapıştırıp Kaydet, sonra Google ile bağlan; "Google hasn't verified this app" çıkarsa Advanced > Go to (unsafe)."""),
    "tiktok": ("TikTok", "TikTok paylaşımını", """Ne kuruyoruz: Stüdyo TikTok API'si kullanmıyor; TikTok Studio'yu Edge ya da Chrome ile, stüdyonun kendi ayrı tarayıcı profilinde açıp videoyu yüklüyor ve planlıyor. Bunun için Python Playwright paketi ve Edge ya da Chrome gerekli.
Adımlar: 1) Ayarlar > TikTok "Bir kez kurulum gerekli" diyorsa Ayarlar > Bileşenler'deki TikTok yükleme satırında Kur'a basmak (ya da komut isteminde python -m pip install playwright), sonra stüdyoyu yeniden başlatmak. 2) Ayarlar > TikTok > TikTok'a giriş yap: açılan pencerede kendi yöntemimle giriş yapıp pencereyi kapatacağım; şifremi ben yazarım. 3) Bağlantıyı kontrol et ile oturumu doğrulamak, sonra "Planlanan Reels videolarını TikTok'ta da planla" seçeneği ve görünürlük. Güvenlik doğrulaması (captcha) çıkarsa onu ben çözerim."""),
    "cloudflare": ("Bulut yayın (Cloudflare)", "bulut yayını (Cloudflare)", """Ne kuruyoruz: Stüdyo kendi ücretsiz Cloudflare hesabıma küçük bir servis (Worker + KV) kuruyor; planlanan Reels videoları oraya yükleniyor ve saati gelince bilgisayarım kapalıyken de Instagram'da paylaşılıyor. Yalnızca ücretsiz plan, kart gerekmiyor.
Adımlar: 1) dash.cloudflare.com/sign-up ile ücretsiz hesap açıp e-postayı doğrulamak (hesabım varsa geç). 2) dash.cloudflare.com/profile/api-tokens > Create Token > Edit Cloudflare Workers > Use template. 3) Account Resources: kendi hesabım, Zone Resources: All zones. 4) İsteğe bağlı: + Add more > Account > Account Analytics > Read. 5) Continue to summary > Create Token > Copy. 6) Stüdyoda Ayarlar > Bulut yayın > Bağla penceresine anahtarı kendim yapıştırıp Bağla'ya basacağım; adımlar yeşil tikle bitince tamam."""),
    "elevenlabs": ("ElevenLabs seslendirme", "ElevenLabs seslendirmesini", """Ne kuruyoruz: Videoların seslendirmesi ElevenLabs API'siyle yapılıyor. Bir ya da birkaç ElevenLabs hesabının API anahtarını stüdyoya ekleyeceğim; birinin kredisi biterse sıradakine geçiliyor.
Adımlar: 1) elevenlabs.io'da hesap açmak (başlamak için Free plan yeter). 2) Developers > API Keys > Create API Key; Restrict Key açıksa Text to Speech: Access, Voices: Read, User: Read, gerisi No Access. 3) Anahtarı stüdyoda Ayarlar > Seslendirme > ElevenLabs hesapları bölümündeki API anahtarı kutusuna kendim yapıştırıp Hesap ekle'ye basacağım. 4) Ses seçmek: ücretsiz planda API'de yalnızca hazır sesler çalışır, "Ücretsiz planda çalışanlar" sekmesinden seçmek."""),
    "ajanlar": ("Claude ajanları", "video ajanlarını (Claude Code oturumları)", """Ne kuruyoruz: Stüdyo videoları kendisi üretmiyor; işleri Claude Code oturumları (ajanlar) yapıyor. Her ajan stüdyo klasöründeki AJAN_TALIMAT.md'yi uygular ve iş bekler.
Adımlar: 1) Claude masaüstü uygulamasında Code sekmesinde yeni oturum açıp klasör olarak stüdyo klasörünü seçmek. 2) Stüdyonun üst çubuğundaki Claude göstergesine tıklayıp hesap kartındaki Bu hesaba ajan ekle > Video ajanı metnini kopyala; metni yeni oturuma yapıştırıp göndermek. 3) Ajan AJAN_TALIMAT.md'deki Döngü'yü izler: oturum bilgisini usage-report ile bildirir, python -X utf8 studio.py wait --agent "Sosyal Ajan 1" komutunu arka planda çalıştırır, gelen tek işi bitirip wait'i yeniden başlatır. 4) İsteğe bağlı: fikirler için ayrı oturumda "Sosyal Fikir Ajanı" (wait --only ideas,caption), limit ve model için "Yönetici" (studio.py manage-wait)."""),
    "bilesenler": ("Eksik bileşenler", "eksik bileşenleri", """Ne kuruyoruz: Stüdyonun bazı işleri için ek bileşenler gerekiyor. Ayarlar > Bileşenler'deki Kurulum durumu listesi her birini gösterir: Video motoru (Python paketleri numpy, scipy, soundfile, Pillow ve Node.js), ffmpeg ve ffprobe, Microsoft Edge ya da Google Chrome, isteğe bağlı TikTok yükleme (Playwright paketi) ve Konuşma tanıma (yaklaşık 1,6 GB model).
Adımlar: 1) Kurulum durumu listesindeki eksikleri birlikte okumak. 2) Satırda İndir ya da Kur düğmesi varsa onu kullanmak (ffmpeg, TikTok yükleme, Konuşma tanıma). 3) Eksik Python paketleri için listede yazan python -m pip install komutunu çalıştırmak; Node.js yoksa nodejs.org'dan LTS sürümünü ya da winget install OpenJS.NodeJS.LTS ile kurmak. 4) Stüdyoyu yeniden başlatıp listeyi kontrol etmek. Bir komut çalıştırmadan önce ne yaptığını bana söyle."""),
}


def guide_path(topic):
    return core.ROOT / "kurulum" / f"{topic}.md"


def build(topic):
    title, what, body = TOPICS[topic]
    url = GUIDE_URL.format(topic)
    path = guide_path(topic)
    local = f"Stüdyo klasörüm: {core.ROOT} (rehberin yerel kopyası: {path})"
    if core.BUNDLED:
        local += f"\nStüdyo kurulum paketiyle kurulu; python yerine şu komutu kullan: {core.cli()} …"
    parts = [HEAD.format(what=what), body, f"Ayrıntılı rehber: {url}", RULES]
    return {"topic": topic, "title": title, "prompt": "\n\n".join(parts[:3] + [local] + parts[3:]), "web_prompt": "\n\n".join(parts),
            "guide_url": url, "guide_path": str(path), "guide_exists": path.is_file(), "studio_dir": str(core.ROOT)}


def handle_get(h, path, qs):
    if not path.startswith("/api/claude-setup"):
        return False
    if path in ("/api/claude-setup", "/api/claude-setup/"):
        h.send_json({"topics": [{"topic": k, "title": v[0]} for k, v in TOPICS.items()]})
        return True
    m = PATH_RE.match(path)
    if not m or m.group(1) not in TOPICS:
        h.fail("bilinmeyen kurulum konusu", 404)
        return True
    h.send_json(build(m.group(1)))
    return True
