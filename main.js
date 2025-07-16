import { getMoviesBySearchTerm } from './api.js';
import { getMovieDetailsById } from './api.js';
import { renderMovie } from './render.js';
import { fetchLists, watchlist, likes, cache, toggleWatchlistStatus, toggleLikeStatus } from './storage.js';
import { TOP_FILMS } from './top-films.js';

const moviesContainer = document.getElementById('movies-container');
const searchInput = document.getElementById('search-input');

let currentSearchTerm = '';

document.getElementById('search-container').addEventListener('submit', async function (e) {
  e.preventDefault();
  document.activeElement.blur(); // Remove focus from the search input to dismiss the on-screen keyboard on mobile
  currentSearchTerm = searchInput.value;
  await handleSearch(currentSearchTerm);
});

document.getElementById('movies-container').addEventListener('click', function (e) {
  const watchlistButton = e.target.closest('.watchlist-button');
  const likeButton = e.target.closest('.like-button');
  if (watchlistButton) {
    toggleWatchlistStatus(watchlistButton.dataset.imdbId);
    watchlistButton.classList.toggle('in-watchlist');
  } else if (likeButton) {
    toggleLikeStatus(likeButton.dataset.imdbId);
    likeButton.classList.toggle('in-likes');
  }
});

document.getElementById('open-watchlist').addEventListener('click', function () {
  searchInput.value = '';
  handleShowWatchlist();
});

document.getElementById('open-likes').addEventListener('click', function () {
  searchInput.value = '';
  handleShowLikes();
});

document.getElementById('open-top-films').addEventListener('click', function () {
  searchInput.value = '';
  handleShowTopFilms();
});

async function handleShowLikes() {
  moviesContainer.innerHTML = '';

  if (likes.size === 0) {
    moviesContainer.classList.add('empty');
    moviesContainer.innerHTML = '<p class="placeholder-text">You haven\'t liked any movies yet.</p>';
    return;
  }

  await renderMoviesFromIDs(Array.from(likes).reverse());
}

async function handleShowWatchlist() {
  moviesContainer.innerHTML = '';

  if (watchlist.size === 0) {
    moviesContainer.classList.add('empty');
    moviesContainer.innerHTML = '<p class="placeholder-text">Your watchlist is empty.</p>';
    return;
  }

  await renderMoviesFromIDs(Array.from(watchlist).reverse());
}

async function handleShowTopFilms() {
  moviesContainer.innerHTML = '';
  moviesContainer.classList.add('empty');
  moviesContainer.innerHTML = '<div class="spinner loading"></div>';

  console.log('Loading top films:', TOP_FILMS);
  try {
    await renderMoviesFromIDs(TOP_FILMS);
  } catch (error) {
    console.error('Error loading top films:', error);
    moviesContainer.classList.add('empty');
    moviesContainer.innerHTML = '<p class="placeholder-text">Error loading top films. Please try again.</p>';
  }
}

async function handleSearch(searchTerm) {
  moviesContainer.classList.add('empty');
  moviesContainer.innerHTML = '<div class="spinner loading"></div>';
  const searchResults = await getMoviesBySearchTerm(searchInput.value);
  const imdbIds = searchResults.map(movie => movie.imdbID);

  await renderMoviesFromIDs(imdbIds, searchTerm);

  console.log('Search complete');
}

async function renderMoviesFromIDs(imdbIDs, searchTerm = null) {
  let renderedAtLeastOneMovie = false;
  let failedAttempts = 0;

  for (const imdbId of imdbIDs) {
    try {
      let movieDetails;
      let shouldRateLimit = false;

      if (cache[imdbId]) {
        movieDetails = cache[imdbId];
      } else {
        // Add retry logic with delay
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            movieDetails = await getMovieDetailsById(imdbId);
            break;
          } catch (error) {
            if (attempt === 3) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          }
        }
        shouldRateLimit = true;
      }

      if (!movieDetails || !movieDetails.imdbID) {
        throw new Error(`Failed to fetch details for movie ${imdbId}`);
      }

      // It's possible that the search term changed while we were waiting for our promise to resolve
      // because the underlying API is flaky and can take a while to respond for certain films
      if (searchTerm && currentSearchTerm !== searchTerm) {
        console.warn(`Search term changed, skipping render of ${movieDetails.Title} (${imdbId})`);
        return;
      }

      // Don't render movies with <50 IMDB votes if the movie year is in the past
      // This eliminates obscure movies w/o eliminating upcoming movies with no ratings
      // We early-terminate the loop to avoid unnecessary requests because the results are sorted by votes
      // Exceptions are made for the first movie, which is always rendered
      const imdbVotes = parseInt(movieDetails.imdbVotes.replace(/,/g, ''));
      const currentYear = new Date().getFullYear();
      if (renderedAtLeastOneMovie && (isNaN(imdbVotes) || imdbVotes < 50) && parseInt(movieDetails.Year) < currentYear) {
        console.info(`Skipping render of ${movieDetails.Title} (${imdbId}) due to low popularity`);
        break;
      }

      renderedAtLeastOneMovie = true;
      // Remove the search spinner after at least one movie has been rendered
      const spinner = document.querySelector('.spinner');
      if (spinner) {
        spinner.classList.remove('loading');
      }
      moviesContainer.classList.remove('empty');

      const movieHtml = renderMovie(movieDetails, watchlist.has(imdbId), likes.has(imdbId));
      moviesContainer.insertAdjacentHTML('beforeend', movieHtml);
    } catch (error) {
      console.error(`Error rendering movie ${imdbId}:`, error);
      failedAttempts++;
      continue;
    }
  }

  // Update the empty state message to include failed attempts
  if (!renderedAtLeastOneMovie) {
    moviesContainer.classList.add('empty');
    const message = failedAttempts > 0
      ? `Unable to load movies. ${failedAttempts} movies failed to load. Please try again.`