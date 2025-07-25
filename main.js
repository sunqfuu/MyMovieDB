import { getMoviesBySearchTerm } from './api.js';
import { getMovieDetailsById } from './api.js';
import { renderMovie } from './render.js';
import { fetchLists, watchlist, likes, cache, toggleWatchlistStatus, toggleLikeStatus } from './storage.js';

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
  for (const imdbId of imdbIDs) {
    let movieDetails;
    let shouldRateLimit = false;

    if (cache[imdbId]) {
      movieDetails = cache[imdbId];
    } else {
      movieDetails = await getMovieDetailsById(imdbId);
      shouldRateLimit = true;
    }

    if (!movieDetails || !movieDetails.imdbID) {
      console.error(`Skipping movie ${imdbId} due to failed fetch or error response`);
      continue;
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
  }

  // Handle case where search results were empty or only contained movies that we skipped
  if (!renderedAtLeastOneMovie) {
    moviesContainer.classList.add('empty');
    moviesContainer.innerHTML = '<p class="placeholder-text">We couldn\'t find any results for that search. Please try again.</p>';
  }
}

fetchLists();