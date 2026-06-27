<?php

declare(strict_types=1);

$lang = 'uk';
$title = 'Товарний — Графік';

?>
<!DOCTYPE html>
<html lang="<?= htmlspecialchars($lang, ENT_QUOTES, 'UTF-8') ?>">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?></title>
  <link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@400;600;800&family=Onest:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/main.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
</head>
<body>

<header>
  <h1>ТОВАРНИЙ ГРАФІК</h1>
  <div class="divider"></div>
  <nav>
    <button type="button" class="nav-btn active" data-page="schedule">📅 Графік</button>
    <button type="button" class="nav-btn" data-page="employees">👥 Персонал</button>
    <button type="button" class="nav-btn" data-page="products">📦 Товари PLU</button>
    <button type="button" class="nav-btn" data-page="export">📷 Фото таблиці</button>
  </nav>
  <div class="header-right">
    <button type="button" class="btn btn-ghost btn-sm" id="btnAddEmployee">+ Співробітник</button>
    <button type="button" class="btn btn-primary btn-sm" id="btnSaveAll">💾 Зберегти</button>
  </div>
</header>

<div class="app">
  <aside class="sidebar">
    <div class="sidebar-section">
      <div class="sidebar-label">Розділи</div>
      <div class="sidebar-item active" data-filter-section="all">
        <div class="dot" style="background:var(--accent)"></div>
        Всі відділи
      </div>
      <div class="sidebar-item" data-filter-section="сборка">
        <div class="dot" style="background:var(--green)"></div>
        Сборка
      </div>
      <div class="sidebar-item" data-filter-section="стеллажка">
        <div class="dot" style="background:var(--accent2)"></div>
        Стеллажка
      </div>
      <div class="sidebar-item" data-filter-section="ягода">
        <div class="dot" style="background:#be185d"></div>
        Ягода
      </div>
      <div class="sidebar-item" data-filter-section="склад">
        <div class="dot" style="background:var(--yellow)"></div>
        Склад
      </div>
    </div>
    <div class="sidebar-section" style="border-top:1px solid var(--border);padding-top:16px">
      <div class="sidebar-label">Фільтри</div>
      <div class="sidebar-item active" data-filter-age="all">
        <div class="dot" style="background:var(--muted)"></div>
        Всі вікові
      </div>
      <div class="sidebar-item" data-filter-age="adult">
        <div class="dot dot-normal"></div>
        Тільки 18+
      </div>
      <div class="sidebar-item" data-filter-age="minor">
        <div class="dot dot-18plus"></div>
        До 18 років
      </div>
    </div>
    <div class="sidebar-section" style="border-top:1px solid var(--border);padding-top:16px">
      <div class="sidebar-label">Місяці</div>
      <div id="monthNav"></div>
    </div>
  </aside>

  <main class="main">

    <div class="page active" id="page-schedule">
      <div class="page-title" id="scheduleTitle">Графік</div>
      <div class="stats-bar" id="statsBar"></div>
      <div class="month-tabs" id="monthTabs"></div>
      <div class="week-selector" id="weekSelector"></div>
      <div class="schedule-hint schedule-hint-callout">
        <p><strong>План та ліміти.</strong> У комірці дня — до <strong>12</strong> робочих годин плану. Значення <strong>0</strong> або <strong>В</strong> означають відпустку в цей день (не входять у суму «План»). Пуста комірка — день без запису.</p>
        <p>Стовпці <strong>Норма</strong> та <strong>Біржа</strong> рахуються <em>автоматично</em> із суми «План»: спершу заповнюється звичайний час до <strong>176×ставка</strong>, далі понад це і до індикативного максимуму <strong>248×ставка</strong> — це биржа (<strong>(248−176)×ставка</strong>).</p>
        <p>План понад <strong>248×ставка</strong> можна зберігти; показуватиметься лише попередження й позначка в рядку.</p>
      </div>
      <div class="legend">
        <div class="legend-item"><div class="legend-dot" style="background:var(--orange)"></div>Вихідний</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--accent)"></div>Робочий день колонки</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--green)"></div>18+ · норма (звич. години)</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--accent2)"></div>Біржа (до пулу 72×ставка)</div>
        <div class="legend-item"><div class="legend-dot" style="background:rgba(255,77,109,0.3)"></div>До 18 р.</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--yellow)"></div>Відпустка в дні (0 або В)</div>
      </div>
      <div id="scheduleTables"></div>
    </div>

    <div class="page" id="page-employees">
      <div class="page-title">Персонал</div>
      <div class="search-bar">
        <input class="search-input" type="search" placeholder="Пошук за іменем..." id="empSearch" autocomplete="off">
        <select class="filter-select" id="empSectionFilter">
          <option value="all">Всі відділи</option>
          <option value="сборка">Сборка</option>
          <option value="стеллажка">Стеллажка</option>
          <option value="ягода">Ягода</option>
          <option value="склад">Склад</option>
        </select>
        <button type="button" class="btn btn-primary btn-sm" id="btnAddEmployee2">+ Додати</button>
      </div>
      <div class="employees-grid" id="employeesGrid"></div>
    </div>

    <div class="page" id="page-products">
      <div class="page-title">Каталог товарів</div>
      <div class="search-bar">
        <input class="search-input" type="search" placeholder="Пошук за назвою, PLU або ART..." id="productSearch" autocomplete="off">
        <select class="filter-select" id="productCategoryFilter">
          <option value="all">Всі групи</option>
          <option value="овочі">Овочі</option>
          <option value="фрукти">Фрукти</option>
          <option value="гриби">Гриби</option>
          <option value="ягода">Ягода</option>
          <option value="інше">Інше</option>
        </select>
        <button type="button" class="btn btn-primary btn-sm" id="btnAddProduct">+ Додати товар</button>
      </div>
      <div class="products-manage" id="productsManage"></div>
      <div class="products-export-bar">
        <div class="products-page-mode" role="group" aria-label="Кількість сторінок PLU">
          <button type="button" class="mode-btn active" data-products-pages="1">1 сторінка</button>
          <button type="button" class="mode-btn" data-products-pages="2">2 сторінки</button>
        </div>
        <button type="button" class="btn btn-success" id="btnDownloadProductsImage">📷 Зберегти таблицю як зображення</button>
        <button type="button" class="btn btn-ghost" id="btnPrintProducts">🖨️ Друк таблиці</button>
        <button type="button" class="btn btn-info" id="btnExportProductsPDF">📄 Експорт PDF</button>
        <button type="button" class="btn btn-info" id="btnExportProductsCSV">📊 Експорт Excel</button>
      </div>
      <div id="productsTablePreview"></div>
    </div>

    <div class="page" id="page-export">
      <div class="page-title">Фото таблиці</div>
      <div class="export-actions">
        <div class="month-tabs" id="exportMonthTabs" style="margin:0"></div>
      </div>
      <div class="export-actions">
        <button type="button" class="btn btn-success" id="btnDownloadImage">📷 Зберегти як зображення</button>
        <button type="button" class="btn btn-ghost" id="btnPrint">🖨️ Друк</button>
        <button type="button" class="btn btn-info" id="btnExportGraphPDF">📄 Експорт PDF</button>
        <button type="button" class="btn btn-info" id="btnExportGraphCSV">📊 Експорт Excel</button>
      </div>
      <div id="exportPreview"></div>
    </div>

  </main>
</div>

<div class="modal-overlay" id="empModal">
  <div class="modal">
    <h3 id="empModalTitle">Додати співробітника</h3>
    <div class="form-row">
      <div class="form-group">
        <label>Прізвище</label>
        <input type="text" id="empLastName" placeholder="Іванов" autocomplete="family-name">
      </div>
      <div class="form-group">
        <label>Ім'я</label>
        <input type="text" id="empFirstName" placeholder="Іван" autocomplete="given-name">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Ставка</label>
        <select id="empRate">
          <option value="0.25">0.25</option>
          <option value="0.5">0.5</option>
          <option value="0.75">0.75</option>
          <option value="1" selected>1.0</option>
        </select>
      </div>
      <div class="form-group">
        <label>Відділ</label>
        <select id="empSection">
          <option value="сборка">Сборка</option>
          <option value="стеллажка">Стеллажка</option>
          <option value="ягода">Ягода</option>
          <option value="склад">Склад</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>18+ (дорослий)</label>
      <div class="toggle-group">
        <div class="toggle on" id="empAgeToggle" role="button" tabindex="0" aria-pressed="true"></div>
        <span id="empAgeLabel" style="font-size:13px">Так — 18+</span>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="empModalCancel">Скасувати</button>
      <button type="button" class="btn btn-primary" id="empModalSave">Зберегти</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="productModal">
  <div class="modal">
    <h3 id="productModalTitle">Додати товар</h3>
    <div class="form-row">
      <div class="form-group">
        <label>PLU</label>
        <input type="text" id="productPlu" placeholder="4011" inputmode="numeric" autocomplete="off">
      </div>
      <div class="form-group">
        <label>ART</label>
        <input type="text" id="productArt" placeholder="12345" autocomplete="off">
      </div>
    </div>
    <div class="form-group">
      <label>Назва</label>
      <input type="text" id="productName" placeholder="Помідори чері" autocomplete="off">
    </div>
    <div class="form-group">
      <label>Група</label>
      <select id="productCategory">
        <option value="овочі">Овочі</option>
        <option value="фрукти">Фрукти</option>
        <option value="гриби">Гриби</option>
        <option value="ягода">Ягода</option>
        <option value="інше" selected>Інше</option>
      </select>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="productModalCancel">Скасувати</button>
      <button type="button" class="btn btn-primary" id="productModalSave">Зберегти</button>
    </div>
  </div>
</div>

<div class="toast" id="toast" role="status" aria-live="polite"></div>
<canvas id="exportCanvas" aria-hidden="true"></canvas>

<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js" crossorigin="anonymous"></script>
<script src="assets/js/app.js" defer></script>
</body>
</html>
