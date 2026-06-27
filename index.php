<?php

declare(strict_types=1);

/**
 * Якщо DocumentRoot Apache вказує на цю папку (а не на /public),
 * перенаправляємо на публічний каталог застосунку.
 */
header('Location: public/', true, 302);
exit;
